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

### Seasons & the Agricultural Year

A year is **120 days**: Spring, Summer, Autumn and Winter, 30 days each. The seasons drive the weather, and they also shape the economy. Food is plentiful and cheap at harvest and scarce and dear in the lean months, so it pays to plan ahead.

The top bar shows the season (🌱 ☀️ 🍂 ❄️) and **Lean** during the lean weeks. Hover it to see the **season outlook**: what's producing, what's cheap or dear, and which way prices are heading. The settlement trade panel opens with the same outlook.

**Harvest cycle.** Farms and food producers follow a seasonal curve. Each curve averages exactly 1 over the year, so **yearly totals don't change**. Only the timing does.

| Producer | Spring | Summer | Autumn | Winter |
|---|---|---|---|---|
| Crops (Farm, Irrigated Farm, Hemp Farm) | ×0.4 sowing | ×1.0 growing | **×2.2 harvest** | ×0.4 fallow |
| Orchards & gathering (Orchard, Forager's Hut, Apiary, Herb Garden) | ×0.5 | ×1.5 | ×1.7 | ×0.3 |
| Herds (Pasture, Dairy, Cattle Ranch) | ×1.3 lambing | ×1.1 | ×0.9 | ×0.7 |
| Fishing (Fishing Fleet, fishing boats) | ×1.1 | ×1.3 | ×1.0 | ×0.6 |
| Hunting (Hunting Lodge) | ×0.8 | ×0.9 | ×1.4 | ×0.9 |
| Settlement food brought to market | ×0.6 | ×1.0 | ×1.8 | ×0.6 |

Workshops, mines, quarries and other non-food properties produce the same amount all year. **Storage matters at harvest.** A farm turns out twice its usual grain in autumn, so its store (100 per level; +50% with Granary Construction) fills fast. Collect regularly or the surplus is lost.

**Seasonal prices.** Food (grain, flour, bread, fish, meat, cheese, fruit, berries, honey and preserved foods) follows the year:

| Time of year | Food prices |
|---|---|
| End of autumn (after the harvest) | **about −30%**, the cheapest |
| Early winter | about −15%, starting to rise |
| Late winter | about +15% to +28% |
| Early spring (before the new crop) | **about +30%**, the dearest |
| Summer | about normal |

Furs and hides are dearest in early winter (about +25%) and cheapest in summer (about −20%). The seasonal swing applies to both buying and selling at settlement markets, to auto-sell, and to regional market prices. In the trade panel, each seasonal good shows **▲ rising / ▼ falling / ▬ steady** with its current seasonal markup. **Buy low, sell high:** grain bought in a capital after the harvest (0.8 × 0.7 of base) sells for about 0.7 × 1.3 of base in the lean weeks. Hold it in your packs or in your properties' stores.

**The lean season** runs from **day 16 of Winter to day 25 of Spring**. A settlement with fewer than **5 days of food in store** loses up to **8 happiness** during these weeks, at 1 point a day. Stores are measured against the food a settlement can't grow for itself. The mood comes back as the stores refill or the season turns. Happiness raises your tax take and colony loyalty. **Selling food to a settlement fills its granary**, so you can relieve a hungry town of your own.

**Seasonal events.** Timed world events favour their season. **Floods** strike mostly in spring (×2.5), **droughts** in summer (×2.5), **bountiful harvests** in autumn (×3, never in winter), and **blizzards** in winter (×3, never in summer). **Hungry Months** (famine: food prices +40%, growth −30%, farm output −15%, −6 stability, −8 morale) strikes in the lean months and never at harvest time.

**Campaign season.** Kingdoms declare war more readily in summer (×1.5) and autumn (×1.2), when the roads are dry and the granaries full. They do so less in spring (×0.8) and least in winter (×0.5), when snow also slows the fighting.

**Seasonal work:**
- **Spring: Planting Contract** (villages and towns, 4 AP, takes the day). Help sow the fields for an advance of 8–15g now plus a **share of the harvest (45–80g, ×1.25 in towns)**, paid a few days into autumn wherever you are. A drought or flood there at harvest time cuts the share; a bountiful harvest raises it. You can hold up to 3 at once, one per settlement per year. If the settlement is destroyed, the contract is void.
- **Seasonal day labour** (Look for Work): each season adds its own jobs alongside the usual three. Spring has Sowing Hand and Flood Banks; Summer has Army Sutler and Haymaker; **Autumn has Harvest Reaper (35–65g), Fruit Picker and Granary Loader (40–70g)**, the best-paid labour of the year; Winter has Snow Clearer and Firewood Hauler.
- **Winter: Trap Furs** (4 AP, takes the day) on cold wild ground: forest, hills, highlands, tundra or snow. You catch 1–3 pelts (+1 per 4 combat skill, up to +2), sometimes meat, and now and then a prize fur (+3 pelts).
- **Winter: Ice Fishing** (3 AP, takes the day) on a frozen river or beside a frozen lake. You catch 2–5 fish and sometimes a large fish.

"Cold ground" means tundra, snow or ice, or any tile whose winter temperature falls below freezing (cold northern and highland regions). Warm southern lands never freeze.

### Food & Starvation

You consume 1 food per day. If you have no food:
- **Starvation days** begin accumulating.
- Health loss per day: 5 + (3 × starvation days) — this escalates quickly.
- Maximum stamina decreases (minimum 2).
- No health regeneration.

Always keep food in your inventory. Buy bread at settlements, catch fish near water, hunt in the wilderness, or produce grain from farms.

### Needs & Mood

Six needs (0–100) sit under the mood meter in the bottom bar: **hunger, energy, social, fun, hygiene, comfort**. Hover a bar for its value, or the mood label for its current effects.

- **Decay.** A world-map day drains hunger 20, energy 35, social 7, fun 7, hygiene 8, comfort 10. On the inner map needs drain per hour instead (a little faster, since food, beds and benches are close by); hours spent there are taken off that day's world-map drain, so nothing is counted twice.
- **Refilling.** The daily ration gives +35 hunger, and **Eat a Meal** (world map, 0 AP, when hunger is below 85) eats the best food in your pack. The night's rest depends on where you sleep: an **inn room** (tavern) restores the most, then your **own house**, then a **camp** (Rest / Camp, or ending the day inside any settlement), and sleeping rough restores the least. Tavern drinks, gossip, meals and baths, social actions (meet people, talk to locals, feasts, festivals) and inner-map furniture (chairs, baths, instruments, games, wells) all refill specific needs.
- **Warnings.** A need at 30 or below gives a warning, and 15 or below a critical one, once a day.
- **Mood** is 60% your average need plus 40% your lowest need:
  - **80+ (in high spirits):** +5% battle power and personal melee damage, +3% trade prices, +1 diplomacy (which also helps negotiations and reputation), and +10% reputation earned.
  - **Below 30 (miserable):** −5% battle power and damage, −3% trade prices, −1 diplomacy, and −2 movement a day.
  - **Below 15 (desperate):** you also lose 3 health a day, and movement drops by 4 instead.

If you eat every day and sleep under a roof, hunger, energy and comfort stay high. Social, fun and hygiene drift down over about a week unless you visit taverns, talk to people or bathe.

### Character Traits

Your character becomes someone through what they do. Every notable deed is counted, and once a deed tally passes a trait's threshold you **earn that trait**. A notification announces each trait you gain or lose, and the **Character Sheet** lists your traits, their effects, your progress toward the next ones ("Becoming…"), and your dynasty's reputation.

**What counts.** Battles won and monsters slain (Valor); your army breaking and running (Cowardice); raids, attacks on pilgrims, refugees, envoys and settlers, threats and assassinations (Cruelty, Dread); taking bounties alive, alms for beggars and children (Mercy); extortion, raids, piracy and selling your soul (Greed); gifts, rounds of drinks and festivals (Generosity); prayer, miracles, holy sites, temples and sermons (Piety, Zeal); informants and spy missions (Cunning); finished quests, contracts and alliances (Honesty); escaping servitude, renouncing allegiance and recruiting a bounty instead of turning it in (Deceit); trade profit; pirates beaten and sea battles won (Seafaring); research, ruins and religious lore (Learning); dice (Gambling); drinking in taverns; festivals and light taxes (Popularity); conquest and threats (Dread); new settlements, ruins and treasures (Travel); tournament placings at your festivals. While you rule lands (a colony or royal office), heavy taxes count as greed each day and light taxes as generosity and popularity. Violence against the realm you married into is **kinslaying**.

| Trait | Earned by | Effects |
|---|---|---|
| 🦁 Brave / 🐇 Craven | Valor / Cowardice | +5% / −5% battle power; military faction and lords react |
| 🩸 Cruel / 🕊️ Merciful | Cruelty / Mercy | Cruel: intimidate 1 easier, townsfolk warm 25% slower, commons and clergy dislike you. Merciful: the reverse, +20% goodwill |
| 💰 Greedy / 🎁 Generous | Greed / Generosity | Greedy: +3% prices, −15% goodwill. Generous: +25% goodwill, +5% reputation gains, −2% prices |
| 🙏 Pious | Piety | +10 clergy support, +2% negotiation; pious lords like you (+15) |
| 🔥 Zealous | Zeal | +8 clergy, +3% battle power, but merchants and townsfolk are wary |
| 🦊 Cunning | Cunning | +4% negotiation, +1 diplomacy, intimidate 1 easier |
| 🤝 Honest / 🎭 Deceitful | Honesty / Deceit | Honest: +5% negotiation, +5 lord opinion, nobles and merchants trust you. Deceitful: −5% negotiation, −8 lord opinion (honourable lords −15) |
| ⚖️ Merchant Prince | 5,000 gold trade profit | +5% prices, +10 merchants faction |
| ⚓ Sea Wolf | Seafaring | +3% battle power, +3% reputation gains |
| 📜 Scholar | Learning | +1 diplomacy, +2% negotiation |
| 🎲 Gambler | Gambling | Better odds at dice; fades if you stop playing |
| 🍺 Drunkard | Drinking | +10% goodwill, −3% negotiation, −2% battle power; fades if you stop drinking |
| 💖 Beloved of the People / 💀 Dread Lord | Popularity / Dread | Beloved: +30% goodwill, +12 commons, +5% reputation. Dread Lord: intimidate 2 easier, but townsfolk warm at half speed and the commons hate you |
| 🧭 Wanderer | Travel | +2% prices, +10% goodwill, +0.5 diplomacy |
| 🗡️ Kinslayer | Kinslaying | A permanent stain: −15 lord opinion, clergy and nobles shun you |
| 🏆 Champion of Tournaments | Tournament placings | +3% battle power, +6 nobility, +5% reputation |

- **Opposites** (Brave/Craven, Cruel/Merciful, Greedy/Generous, Honest/Deceitful, Beloved/Dread Lord) cannot coexist: earning one replaces the other.
- **Erosion.** Deeds against a trait wear it down (lies erode Honest, greed erodes Generous, mercy and festivals erode Dread Lord, and so on). A trait is lost once its progress falls below half its threshold. Progress caps at twice the threshold, so a deeply held trait takes a long run of contrary deeds to undo.
- **Who notices.** "Goodwill" scales how fast inner-map townsfolk warm to you. Lords add your traits to their opinion of you, and their own traits matter: a Pious lord likes a Pious player, a Cruel lord respects a Dread Lord, and an Honourable lord despises a Deceitful one. Traits also shift the council factions, the reputation you earn with kingdoms, and negotiation chances. Townsfolk sometimes greet you by your reputation.

### Death & Succession

Your character has a natural lifespan of 55–85 years (randomized). After your maximum age, there is a 15% chance of death per year that increases over time. If you die with an heir aged 16+, you continue playing as your heir, who inherits 75% of your gold, 50% of your renown, and 30% of your reputation. Without an heir, the game ends. Traits are **not** inherited. Instead your House keeps a *reputation of the dynasty*: the late ruler's two strongest traits at half strength. This echo only affects how others react to you (goodwill, lords, intimidation, reputation, council factions), and it fades by about a quarter of a percent a day until it is gone.

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

**Rivers:** entering a river hex on foot costs **+2** stamina on top of its terrain cost. A road (world-generated or built) or a Bridge on that hex carries you across with no penalty, and researching **Bridge Construction** halves the fording penalty to **+1** everywhere else. The hex info panel and Region Details show the river surcharge, and pathfinding routes around unbridged rivers when it's cheaper.

### Pathfinding

Click any visible hex to set a destination. The game uses A* pathfinding to calculate the optimal route. If you run out of stamina mid-journey, movement continues automatically the next day.

### Weather

Weather fronts drift east across the map and change every day; the season decides where snow falls and where heat waves bake the land. Hover a hex to see today's weather, what it does, and a three-day forecast.

| Weather | Travel | Farms | Battle | Other |
|---------|--------|-------|--------|-------|
| 🌧️ Rain | −10% | +10% | Archers −15% | |
| ⛈️ Storm | −30% | −10% | Archers −30%, cavalry −10% | Exposure; dangerous seas |
| 🌨️ Snow | −25% | −30% | Cavalry −20% | Exposure |
| ❄️ Blizzard | −50% | −50% | Archers −20%, cavalry −35% | Severe exposure; rough seas |
| 🔥 Heat Wave | −15% | −25% (not on irrigated land) | | Mild exposure |

- **Roads** halve the travel penalty. Sailing is unaffected.
- **Exposure:** ending the day in the open in a storm, blizzard or heat wave costs health and comfort. A settlement, an inn or your own house protects you completely; a deliberate camp halves the loss.
- **Battles** apply the weather to both armies by their makeup, so an archer-heavy host should avoid fighting in the rain.
- **Storms at sea** damage the hulls of ships under way or at anchor, may hold a voyage back a day, and can wash cargo overboard. Docked ships ride it out in harbour.
- A Granary halves bad-weather losses at nearby farms, just as it does for droughts.
- **The world feels it too:** caravans, armies, beasts and raiders cover fewer hexes in bad weather, ships at sea slow in storms, and kingdoms fight fewer pitched battles when the front is snowed in (a blizzard halves the chance).

### Fog of War

You can see 4 hexes in every direction. Tiles you've visited remain "explored" (showing terrain) but only tiles within your current visibility range are "visible" (showing units, settlements, and changes). Spies and technologies can extend your vision.

### Points of Interest

Unexplored tiles may contain points of interest (POIs) — ruins, caves, monuments, shrines and oases. The minor ones (shrines, oases, monuments) are searched with a single **Explore POI** action (4 AP, ends the day) for treasure, knowledge, artifacts, or danger.

### Delves

Ruins and caves are **delves**: expeditions down through 3–6 chambers, the last of which is always a deep finale. What a site turns out to be depends on the land it stands on:

| Delve | Found at | Lore it holds | Deep finales |
|-------|----------|---------------|--------------|
| 🌊 Sunken Ruins | Ruins in swamp, beach, coast, island or lake | Ancient history | The Drowned Throne, The Flooded Vault, The Bell Below |
| ⚰️ Buried Tomb | Ruins in desert, savanna, tundra, snow or highlands | Origins of the peoples (heritage) | The Barrow-King's Rest, The Burial Treasury, The Hall of Judgement |
| 🏚️ Ancient Ruins | Ruins anywhere else | Ancient history | Throne of the Old Kingdom, The Sealed Reliquary, The Hall of Maps |
| ⛏️ Abandoned Mine | Caves in mountains, hills, highlands or peaks | Kingdom foundings | The Deepest Seam, The Thing They Woke, The Foreman's Strongroom |
| 🕳️ Deep Cave | Caves anywhere else | Origins of the peoples (heritage) | The Wyrm's Hoard, The Painted Cavern, The Underground Lake |

**Entering.** Choose **Delve into …** at the site. The entrance screen costs nothing; **Descend** spends 4 AP. If you close the panel mid-delve, **Resume Delve** (free) takes you back to where you were.

**Chambers.** Each chamber (about 30 kinds across the five delves) poses a situation with 2–3 choices — sneak past or fight a guardian, disarm or force a trap, read or burn an inscription, rest or press on, follow the draught or the bones. Each choice shows its **odds** (very likely / likely / even odds / risky / desperate, with a percentage), its cost and a hint at what it tests:
- **Attributes** — strength, charisma, intelligence, faith or luck (±5% per point from 5).
- **Skills** — combat, stealth, diplomacy, leadership, commerce, cartography (+4% per point).
- **Gear** — tools, rope, lantern, compass, weapons, shield, holy water, relics and others you carry. Carried treasures and traits add battle power, damage reduction or negotiation where they apply.
- **Companions** — a hunter in the travel party helps against beasts, a priest against the restless dead, a scholar with inscriptions, a spymaster with locks and traps, a knight in a fight.
- **Traits** — Brave helps in a fight and Craven hurts; Cunning, Pious, Zealous, Scholar, Wanderer and Sea Wolf each help where you'd expect.
- **Depth** — every chamber deeper is 5% harder, and its harm 12% worse. Insight from reading an inscription, honoring a shrine or scouting ahead improves your next roll.
- **The curse** — carrying a cursed idol costs 5% on every roll.

Choices spend **stamina** (today's movement; if you run out you pay 3 health per missing point) and sometimes gold or an item (meat to distract a beast, lamp oil to burn a path). Failure brings harm, which armour and treasures reduce, and may bring a lingering **injury**: a broken arm (−1 strength), concussion (−1 intelligence), fresh scars (−1 charisma) or dark dreams (−1 faith), each lasting 6–12 days. A delve never kills you, but if your health falls to 10 or below you collapse and stagger out with what you carry.

**Rewards.** Gold, goods and renown grow by 25% for every chamber of depth. Loot goes into your packs and respects the inventory cap; what doesn't fit is left behind and shown in your haul. Delves also give lore (World History and the heritage of peoples), ancient maps and treasure maps for your collection, and **legendary artifact fragments**, which the deep finales are the surest place to find. When the delve ends, the site also gets the old relic roll of an Explore and gives up any ancient map hidden there. Reaching the bottom adds bonus renown.

**Turning back.** Between chambers you choose to **Press deeper** or **Turn back with your haul**. Turning back keeps everything you found. Turning back before the first chamber leaves the site untouched for another day. A delve left unfinished ends at the close of the day. Finishing a delve ends the day as you make camp outside.

**Once only, with consequences.** Each site can be delved only once. Some failures leave something behind you:
- An **awakened guardian** (the Stone Sentinel, the Barrow-King, the Drowned Warden, the Horror of the Deep Cave, the Wyrm from the Deep Seam) climbs out and roams the world as a legendary creature for 60 days, or until someone slays it.
- A **Cursed Idol** finds its way into your packs, even when they are full. While you carry it, it saps 1 health and 1 karma a day. Sell it to be rid of it.

**Deeds.** Fighting guardians records valor; sneaking and trickery record cunning or deceit; prayers record piety; looting tombs records greed; reaching the bottom records valor; every delve counts as wandering; and turning back at once from a deep site is noted as cowardice.

### Wilderness Actions

While in the wilderness, you can:

| Action | Requirements | Effect |
|--------|-------------|--------|
| Rest / Camp | Anywhere | End the day, recover stamina |
| Explore Area | Any explored tile | Search the inner map for hidden encounters |
| Meditate / Pray | Any passable tile | Restore health, gain karma (enhanced at holy sites) |
| Go Fishing | Near water | Catch fish for food or sale |
| Prospect | Hills, Highlands, Mountains | Search for mineral deposits |
| Tame Wild Horse | Plains/Grassland with horses | Capture a horse: +2 max stamina, or saddle it at a stable as your mount |
| Build Campfire | 2+ wood in inventory | Extra health restoration |
| Forage | Most wilderness | Gather herbs, berries, materials |
| Hunt | Forest, Plains, Hills | Obtain meat and pelts |
| Trap Furs | Winter, cold forest/hills/tundra/snow | Pelts, sometimes meat or a prize fur (see Seasons) |
| Ice Fishing | Winter, frozen river or lakeside | Fish, sometimes a large fish |
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

Prices are also affected by local supply and demand, terrain resources, world events and **the season**: food is cheap after the harvest and dear in the lean months, furs dear in winter (see [Seasons & the Agricultural Year](#seasons--the-agricultural-year)). Both buy and sell prices move with the season. Each trade earns +0.1 Commerce skill.

**Carrying capacity.** Your packs hold **20 kinds of goods** (stacks are unlimited — 300 grain is one slot). A mount adds +5 slots and each house you own adds +3. When full, you can still add to goods you already carry, but new goods are refused (purchases fail without charging you; battle loot, gathered finds and ground items that don't fit are left behind; crafting is cancelled with ingredients returned). The Inventory panel shows `Packs: used/capacity`. Goods you're owed are never silently lost: quest rewards and stock returned from caravans or retooled workshops are sold on the spot at base price if they don't fit; an auction you win without room is refunded; collected property goods and ship cargo stay where they are; finished tech parts wait at the workshop until you make room.

**Trading with townsfolk.** Merchants, travelers and blacksmiths you meet in a settlement set their own prices from how they feel about you. Disposition shifts prices up to ±20% (Devoted −20%, Hostile +20%), and personality adds to it: *generous* −8%, *kind* −5%, *jovial* −3%, *bold* +2%, *cautious* +3%, *stubborn* +4%, *stern* +5%. Their buy-back price moves the other way. Someone you threatened charges +10% and refuses to trade at all while their disposition is below 25. The trade window lists the reasons.

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
| Coal | 10g | Mines (coal seams) |
| Rock Oil | 22g | Pitch Works (oil seeps) |

### Map Resources and Settlements

Resources on or within 2 hexes of a settlement shape what it produces and how it works (a resource on the settlement's own hex counts in full, a nearby one at half; each effect is capped at +50%). Open a settlement's **Economic Breakdown** to see its "Resource Advantages".

| Bonus | From | Effect |
|-------|------|--------|
| Goods | iron, timber, stone, coal, cattle | More of every good the settlement makes |
| Military | iron, horses, coal | Cheaper recruits for you (half the bonus); the realm's armies regrow faster |
| Trade | gems, spices, salt, horses, oil | More trade-route income; caravans you send there earn half the bonus; sales there a quarter |
| Construction | timber, stone | Your properties, tech buildings and infrastructure cost less and build faster (half the bonus each); damaged towns repair faster |

Coal yields coal, oil yields rock oil, and cattle yield food and hides. Coal also fires forges, blacksmiths and glassworks on or beside it (+25% output), herds help cattle ranches, dairies and tanneries (+30%), and an oil seep helps a chandlery (+20%). Markets on coal, oil or cattle sell them cheaply.

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

You can set tax rates if you govern settlements of your own, or hold the office of **King**, **Chancellor** or **Tax Collector**. Officials sworn to a kingdom need a council vote to *raise* taxes; an independent lord does not. Taxes are collected from your settlements every 7 days.

| Tax Level | Rate | Happiness target | Growth per year |
|-----------|------|------------------|-----------------|
| Very Low | 5% | 65 | +5% |
| Low | 10% | 57 | +2% |
| Moderate | 15% | 50 | — |
| High | 25% | 35 | −5% |
| Very High | 40% | 20 | −10% |

Each settlement's **happiness** (0–100) drifts a quarter of the way toward the target at every collection. It matters:
- **Revenue** is scaled from ×0.75 (happiness 0) to ×1.25 (happiness 100), so squeezing a miserable town yields less than you'd think.
- **Conquered towns** gain or lose loyalty each week by (happiness − 50) / 25, and low-loyalty colonies rebel.
- The Treasury's Tax tab lists each settlement's mood and weekly yield.

### The Council

As King, Chancellor or Tax Collector you answer to a council of five factions. Convene it to hold votes (tax increases, war mandates) and to negotiate with or suppress factions. Between sessions the factions' support drifts (▲/▼ in the panel) toward how you govern:

| Faction | Likes |
|---------|-------|
| 👑 Nobility | Your renown |
| ⚔️ War Hawks | A large army, and a war (peace makes them restless) |
| 💰 Guilds | Trade routes and low taxes |
| ⛪ Clergy | Good karma |
| 🧑‍🌾 Commons | Happy settlements and low taxes |

Council **approval** follows the factions' influence-weighted support. Above 70 it raises your standing with your liege every 5 days; below 30 it lowers it. If approval falls below 15 the council is in uproar, and after 10 days of that it passes a **vote of no confidence** and you lose your office. A suppressed faction can't organise against you until the crackdown ends.

### Petitions & the Court

Once you rule something, people come to you for judgement. You become a **petitioned ruler** when you hold a settlement or colony, hold a royal office (petitions then come from your liege's capital), or head a House of standing (20+ Prestige, or any later generation). Until then no petitioners come.

Every 6–12 days (sooner the more holdings you have) a petitioner arrives with a dilemma, and an end-of-day notice tells you where. Open **⚖️ Hold Court** from the action menu at any of your holdings — an owned settlement or colony, a property, a house you own, or, while in office, any settlement of your kingdom. Up to 3 petitions wait at once.

There are 34 petitions, and each one appears only where it makes sense:

| Condition | Examples |
|-----------|----------|
| Settlement size | Guild monopolies, plague quarantine and miners' strikes need a sizeable town |
| Season | Famine pleas in autumn and winter, droughts in summer, midsummer feasts in spring and summer |
| War | Refugees at the gates, deserters and war-levy pleas only while you (or your liege) are at war |
| Peoples | Quarrels between quarters and foreign rites need two or more peoples in the settlement |
| Faith | Heretic preachers, temple requests, abbeys and pilgrims need a faith there (yours or the kingdom's) |
| Office / House | Council seats and border lords come to office holders; cousins' debts, rival heralds and feud-crossing marriages come to the House |
| Colony | Colonists' charters come only from colonies |

Each petition offers 2–4 choices, and every one has a price. The court panel lists what each choice will cost or gain before you choose:

- **Gold, karma, renown and House Prestige**
- **Settlement happiness, loyalty (colonies) and population**
- **Council faction support** (Nobility, War Hawks, Guilds, Clergy, Commons) and council approval
- **Reputation and stability** of the kingdom the petition comes from
- **Faith**: your own religion's presence in the settlement if you founded one, otherwise the local faith's piety. Some choices also gain your religion followers.
- **Peoples' mood**: the two largest peoples in a quarrel, or every people at a feast
- **Rival feud** with the most aggrieved rival House

Some choices are gambles, such as debating a heretic or answering a herald's insult with a verse. Their odds are shown on the button.

**Consequences follow.** Some rulings schedule a follow-up petition days later that refers back to them. For example:
- A pardoned bandit may return as a loyal captain, or flee with your strongbox.
- A noble's son you let off may kill again.
- A hedge preacher you tolerated may come back with a flock that wants its own chapel.
- Refugees you sheltered may thank you with a harvest, or clash with the townsfolk.
- The miners will come to collect what you promised them.

The panel marks choices that may have consequences. A follow-up is dropped if you have lost the settlement in the meantime.

**Ignoring has a cost.** Every petition expires after a few days (shown in red when two or fewer remain). An expired petition applies its *ignore* cost, such as unhappiness, lost Prestige or an angry faction. **Send them away unheard** pays that cost immediately.

**Your court's reputation.** Each ruling adds to five traits: 🕊️ Mercy, ⛓️ Severity, ⚖️ Justice, 🙏 Piety and 🎁 Generosity, each running from −20 to +20. Kingdom lords remember them, and their opinion of you shifts by up to ±15:

| Lord trait | Likes |
|------------|-------|
| Honorable | Justice (and a little mercy) |
| Pious | Piety (and a little mercy) |
| Cruel | Severity; dislikes mercy |
| Cautious | Mercy; dislikes severity |
| Greedy | A grasping hand (low generosity) |
| Brave | Severity and justice |
| Cunning | Bent justice |

Notable rulings, such as hanging a noble's son, raising a temple or pardoning a bandit, are written into your **House chronicle**. The court panel keeps your recent rulings, and petitions, follow-ups and your court reputation are all saved with the game.

### Finance Tracking

Click your gold display to open a detailed 90-day financial breakdown showing income sources, expense categories, daily logs, and gold-over-time charts.

### Settlement Services

Town buildings sell services with lasting effects. Use them from a building's menu on the local map, or from the furniture inside it. Prices scale with settlement size (village ×0.85 … capital ×1.3).

| Building | Service | Effect |
|----------|---------|--------|
| Blacksmith | Hone Arms (8g per soldier, min 25g) | Army strength +15% for 7 days |
| Temple / Church | Seek Blessing (30g) | +2 movement and +5 healing per day for 5 days, +1 karma |
| Stable | Buy a Riding Horse (160g) | One mount at a time: +3 movement every day. Resells for half |
| Stable | Saddle a Tamed Horse (25g) | Turns a tamed horse into your mount. Spare tamed horses sell for 70g |
| Guard Tower | Settle Your Record | Pay 50g per offense, plus any gossip bounty this crown has posted on you (and 250g if it has a warrant out), to wipe your record, lift the warrant and calm the guards (+3 reputation) |
| Town Hall | Pay Tribute (50 / 150 / 400g) | +1 reputation with the crown per 25g, up to 100 |
| Town Hall / Manor | Seek Audience | Court actions available here: pledge allegiance, seek office, feasts, councils… |

Furniture inside buildings is usable too: beds (in your own home), rented tavern rooms (5g), market stalls (trade), bars (drinks, rumors, gambling), anvils and forges (craft, smelt), altars (pray, donate), barracks racks (hire troops, train) and more.

You use furniture in person: choosing an action walks you up to it first, then you turn to face it and the action happens (with a short sitting, praying or working animation). If you can't reach it, you're told so. Anyone already using it steps aside. Smelted **iron ingots** (75g) and **gold bars** (150g) sell for more than their ore, and they go into forge recipes: weapons, tools and gold rings. **Reading** at a bookshelf trains a real skill (commerce, combat, leadership, diplomacy, stealth or cartography) by +0.2, up to 10.

**Life indoors.** The townsfolk you find inside a building get on with their day. They walk to the furniture that suits them (blacksmiths to the anvil, priests to the altar, travellers to the bar) and use it for a while, with an icon over their heads showing what they're doing. When they're done visiting, they walk out through the door.

### Peoples & Cultures

Every settlement is a mix of peoples (Ironborn, Sailweavers, Frostborn, ...), and who lives there changes how it works. The settlement panel's **What the Peoples Bring** box lists each effect with its number; hover a line to see which peoples cause it. Effects scale with each people's share of the town and are kept small (most stay within a few percent):

| Source | Effect |
|--------|--------|
| Values and traits (e.g. craftsmanship, mercantile, devout, martial) | Crafts (goods production), Enterprise (gold), Husbandry (food), Commerce (trade-route profit, and half that on your buy/sell prices there), Kinship (population growth), Order (mood), Martial, Devotion, Courtesy, Learning, Secrecy, Revelry. Restless, volatile or distrustful peoples count against Order or Courtesy |
| Art forms, the town's signature art and thriving quarters | Craft arts add to goods, songs and dances to Revelry, charts and manuscripts to Learning. A restless quarter costs Order |
| Diaspora status | Traders add Commerce, pilgrims Devotion, refugees Martial, immigrants Kinship. Exiles cost Order |
| Cuisine | Each extra people's kitchen (and each hybrid dish) adds a little food production. Taverns serve the signature dish: a hot meal there gives +6 comfort, and +2 for each hybrid dish (up to +4 more) |
| Customs | A festival you host in a town with a signature festival earns +1 renown (+1 more where the peoples are festive), and every people there gains +3 mood |
| Harmony and hybrid traditions | Harmony above 50 adds Order and below 50 takes it away. Each hybrid tradition adds +1 harmony (up to +5) |
| Homeland | A people living on or next to its homeland terrain gains +1 mood every 10 days (up to 85) |
| Settlement size (evolution stage) | Towns and cities see cultural exchanges more often than villages |
| Origin lore | Once you discover a people's origin story, you get up to +4% better market prices wherever they live |

Martial peoples also give **more recruits and cheaper ones** (shown in the Recruit menu). Order shifts the mood of settlements you tax (shown in the Treasury's tax tab). Across a whole realm, its peoples add to the kingdom's military, faith, diplomacy, research, intrigue and trade, and a **Peoples & harmony** line feeds its stability. The kingdom panel shows the bonus that comes from its peoples.

---

## 5. Properties & Production

Properties are the backbone of your economy. Build them on appropriate terrain to generate resources and gold.

### Property Types

#### Raw producers

| Property | Cost | Build Time | Produces | Upkeep | Where |
|----------|------|-----------|----------|--------|-------|
| 🌾 Farm | 500g | 5 days | Grain (10/day) | 5g/day | Plains, Grassland |
| 🐑 Pasture | 500g | 4 days | Wool (8/day) | 5g/day | Plains, Grassland, Hills |
| 🪓 Logging Camp | 400g | 3 days | Wood (6/day) | 5g/day | Forests |
| ⛏️ Mine | 1000g | 10 days | Iron (5/day) | 15g/day | Resource: Iron/Gold Ore/Gems/Stone |
| ⚓ Fishing Wharf | 800g | 8 days | Raw Fish | 10g/day | Coast, Beach |
| ⛰️ Quarry | 700g | 8 days | Stone (8/day) | 10g/day | Resource: Stone |
| 🧂 Salt Pans | 350g | 4 days | Salt (6/day) | 5g/day | Coast, Beach |
| 🐝 Apiary | 300g | 3 days | Honey (5/day) | 4g/day | Plains, Grassland, Forest, Woodland, Hills |
| 🍎 Orchard | 400g | 5 days | Fresh Fruit (8/day) | 5g/day | Plains, Grassland, Hills, Woodland |
| 🌿 Hemp Farm | 350g | 4 days | Hemp Fiber (8/day) | 4g/day | Plains, Grassland |
| 🟫 Clay Pit | 300g | 3 days | Raw Clay (8/day) | 4g/day | In or next to a settlement |
| 🧀 Dairy | 450g | 4 days | Aged Cheese (4/day) | 6g/day | Plains, Grassland |
| 🏹 Hunting Lodge | 450g | 4 days | Hide (5/day) | 5g/day | Forests |
| 🐄 Cattle Ranch | 550g | 5 days | Meat (8/day) | 6g/day | Plains, Grassland, Savanna |
| 🌱 Herb Garden | 350g | 3 days | Herbs (7/day) | 4g/day | Forests, plains & hills |
| 🐎 Horse Ranch | 1100g | 10 days | Horses (1/day) | 12g/day | Plains, Grassland, Savanna |
| 🫐 Forager's Hut | 250g | 2 days | Berries (8/day) | 3g/day | Forests |

#### Processing buildings (recipe-based)

| Property | Cost | Build Time | Produces | Upkeep | Where |
|----------|------|-----------|----------|--------|-------|
| 🔨 Workshop | 800g | 7 days | Any recipe | 10g/day | In or next to a settlement |
| 🍺 Brewery | 700g | 6 days | Beer / Liquor | 8g/day | In or next to a settlement |
| 🌬️ Mill | 600g | 6 days | Flour | 6g/day | Plains, Grassland, Hills, Woodland, Savanna |
| 🍞 Bakery | 700g | 7 days | Bread | 8g/day | In or next to a settlement |
| 🔥 Forge | 1000g | 9 days | Tools / Weapons | 12g/day | In or next to a settlement |
| 🦺 Tannery | 650g | 6 days | Leather Armor / Parchment | 8g/day | In or next to a settlement |
| 🪚 Sawmill | 500g | 5 days | Firewood | 7g/day | Forests, plains & hills |
| 🍖 Smokehouse | 500g | 5 days | Smoked Fish / Dried Meat | 6g/day | In or next to a settlement |
| 🥩 Butcher | 400g | 3 days | Dried Meat | 5g/day | In or next to a settlement |
| 🪢 Rope Walk | 350g | 3 days | Rope | 5g/day | In or next to a settlement |
| 🏺 Pottery Kiln | 400g | 4 days | Pottery | 5g/day | In or next to a settlement |
| 🧵 Weaver | 500g | 5 days | Textiles / Clothes | 6g/day | In or next to a settlement |
| 🍷 Winery | 700g | 7 days | Fine Wine / Mead | 8g/day | In or next to a settlement |
| ⚗️ Apothecary | 600g | 6 days | Healing Salve / Strange Potion | 8g/day | In or next to a settlement |
| 🏹 Fletcher | 450g | 4 days | Arrows / Bow | 6g/day | In or next to a settlement |
| 💍 Jeweler | 900g | 8 days | Amulet / Luxuries | 10g/day | In or next to a settlement |
| 🎨 Dye Works | 450g | 4 days | Dyes | 6g/day | In or next to a settlement |
| 🕯️ Chandlery | 350g | 3 days | Candles | 5g/day | In or next to a settlement |
| 🔮 Glassworks | 750g | 7 days | Glass / Lantern | 10g/day | In or next to a settlement |
| 📖 Scriptorium | 600g | 5 days | Parchment / Rare Book | 8g/day | In or next to a settlement |
| ⚔️ Blacksmith | 800g | 7 days | Shield / Tools / Weapons | 10g/day | In or next to a settlement |
| 🌸 Perfumery | 650g | 6 days | Perfume / Incense | 8g/day | In or next to a settlement |

#### Commerce

| Property | Cost | Build Time | Produces | Upkeep | Where |
|----------|------|-----------|----------|--------|-------|
| 🏪 Trading Post | 600g | 6 days | Attracts merchants | 5g/day | Settlement |
| 🍻 Tavern | 900g | 8 days | Gold from patrons | 12g/day | Settlement |

A tile can hold **one of each property type** — a Farm, a Mill and a Bakery can all share a hex. When you manage a tile with several properties, pick which one from the list.

### The Mill

The **Mill** (🌬️) grinds grain into flour. Unlike most processing buildings it belongs out in the fields, not in town: build it on plains, grassland, hills, woodland or savanna. A Mill **on a river** turns a water wheel for **+50% output**. Research unlocks two stronger mills: the **Windmill** (12 flour/day) and the **Water Mill** (14/day, can also saw firewood, +50% on a river).

### Same-Tile Supply Chains

A processing building automatically draws its input from the other properties on the **same tile** each day, so no hauling is needed. Build a **Mill beside a Farm** and the harvest is milled straight away; add a **Bakery** and flour turns into bread. Raw producers run first each day, then processing buildings. Anything left over stays in storage to collect. For buildings on other tiles, deposit inputs by hand or send an internal-transfer caravan from the producing property.

A property whose upkeep you can't pay sits idle for the day and keeps its stored inputs.

### Production Bonuses

Base production is modified by several factors:
- **Property Level**: Each upgrade adds +10% production (max level 5).
- **Commerce Skill**: +5% per skill level.
- **Technology**: Various techs boost specific properties (e.g., Crop Rotation gives +20% to farms).
- **Terrain Bonus**: Logging Camps on timber tiles get +50%. Irrigation channels give +50% to farms.

### Storage & Administration

- **Seasons:** farms, orchards, herds, hunting lodges and fishing fleets follow the seasonal curve (autumn harvest ×2.2 for crops, see [Seasons](#seasons--the-agricultural-year)). Yearly totals are unchanged. Auto-sell gets the season's price, so selling into the harvest glut fetches less.
- **Storage:** each producing property holds **100 goods per level**. Output beyond that is lost, so collect, ship, or auto-sell regularly. The **Granary Construction** technology enlarges every store by 50%. The property panel shows `stored / capacity` and warns when goods are being lost.
- **Administrative overhead:** running up to **6 properties** is free. Each one beyond that adds **+3% upkeep to all properties** (max +60%). The **Writing** technology halves this overhead.

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

Workshops, Mills, Bakeries and the other processing buildings transform raw materials into higher-value goods. Each specialised building offers only its own recipes; a Workshop can run any of them.

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

Attribute and skill bonuses from upgrades apply for as long as you own the house, and are removed if you sell it. Each point of Defense adds +1% to your army's power when you are attacked.

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

#### Unit Specials

Some unit types carry special stats that ride with every recruit (the recruit screen lists them; units from older saves pick them up from their type):

| Unit | Special | Effect in play |
|------|---------|----------------|
| Siege Engine | Siege +40 | +40% army power when raiding or besieging a settlement (all engines combined max +100%) |
| Shield Wall | Defense +25 | +10% army power each when you are the one attacked (max +50%) |
| Longbowman | Range +2 | Opening volleys: up to +6% power each, scaled by how melee-heavy (cavalry + pikemen) the enemy is (max +30%) |
| Scout | Sight 4, Speed 8 | +1 fog-of-war radius and +1 movement per day while in your army |
| Assassin | Eliminate commanders | 15% chance each (max 60%) to slay the enemy commander before battle — the enemy's morale breaks |
| Battle Mage | Area damage | Each mage weakens the enemy host by 5% (max 30%) |

Light/Heavy Cavalry and War Elephants fight as cavalry; Longbowmen and Crossbowmen as archers.

#### War Galleys (sea units)

The **War Galley** (350g, 15g/day, strength 20) is a warship, not a soldier. It is recruited only at a **port** (a town or larger on the water) and **never fights on land**: it adds nothing to your land army strength, takes no place in your formation and cannot fall in an inland battle. Where it matters:

| Theatre | When | Who fights |
|---------|------|-----------|
| Land | Battles inland, campaigns, raids/sieges of inland settlements | Soldiers only |
| Coastal | Raiding or besieging a **port** settlement | Soldiers + galleys at 50% (blockading the harbour) |
| Sea | Fights while you're aboard ship or on the water (pirates, sea raiders) | Galleys at 100%, soldiers at 50% fighting from the decks, plus the ship you're aboard |

Galleys also **escort your ships**: half of the squadron's strength is added to every fight your own ships take on (Hunt Pirates, Turn Pirate, pirate ambushes while exploring). A siege still needs a land army — galleys alone cannot take a town. Weights live in `data/military.json` → `navalRules`.

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
- **Wounded**: with Surgery, each would-be casualty has a 30% chance to be carried off wounded instead — it stays in the army at half strength for 5 days, then heals.
- **Armour & bows**: Plate Armor makes the enemy strike 15% weaker and cuts casualties 15%; Crossbow piercing adds +25% power scaled by your archers' share of the army.

### Unit Progression

Units gain XP through combat (+5 XP per battle, +10 XP per contract). At 100 XP, units level up (max level 5), gaining a ×1.2 strength multiplier per level.

### Sieges and Raids

Choosing **Attack** on a settlement opens the siege panel with two options:

- **Siege** — fight the full garrison to conquer the settlement. Heavy karma and reputation penalties with every kingdom.
- **Raid** — fight only half the garrison, plunder its gold and withdraw. No conquest; karma -5, reputation -20 with the owning kingdom (-30 if the raid fails), population -10%. A raided settlement has nothing worth taking for **30 days**.

### Creatures and Travelers

Besides caravans, raiders and patrols, the world holds **mercenary companies, pilgrims, smugglers, envoys and refugee columns** travelling between settlements (refugees add to the population where they arrive), **war fleets** that sink pirate ships, and **wild beasts** and **legendary creatures** that hunt travellers like raiders do. Unarmed, a creature mauls you rather than robbing you. Attacking pilgrims, refugees or envoys costs karma; slaying beasts and legendary creatures earns renown. Their coin goes to your purse and their goods into your packs (if there is room).

**Treasures.** Everything a unit carries is a real, sellable good. The rarer pieces also do something. Look in the Inventory panel for the details:

| Treasure | Carried | Gift to a lord | Enshrine (House Prestige) |
|----------|---------|----------------|---------------------------|
| Enchanted Weapon | +5% battle power | +15 reputation | +3 |
| Dragon Scale | −10% harm taken (a Blacksmith forges 3 into Dragonscale Armour, −25%) | +12 | +4 |
| Ancient Artifact | — | +20 | +6 |
| Royal Seal / Sealed Treaty | +5% / +3% negotiation | +18 / +12 | +3 / — |
| Gift Chest, Fine Wine, Holy Relics, Scriptures | — | +20, +5, +8, +4 | Relics +2 |

Present gifts at a royal audience. Greedy lords value them 25% more, honourable ones 10% more. Holy Water heals 10 health, Rum gives +1 movement for the day, and Rare Herbs brew into an Elixir of Vigor at an Apothecary. Carried bonuses count once for each kind of item and are capped. Timed events (crusades, refugee waves, monster sightings, pirate surges) make their kind far more common.

### Personal Protection

When you are attacked without an army, or brawl on the local map, gear in your pack softens the blows: Leather Armor −20%, Shield −15%, Amulet −10% (they stack). Divine Protection blocks all damage.

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

Mercenaries have a **loyalty** system (45–90 base). If you fail to pay them or their loyalty drops too low, they may switch sides and join a rival kingdom, whose army takes on as many of them as it can feed (up to its cap). Pay bonuses to keep loyalty high.

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

**Tenets** (data/religion.json → `playerTenets`) each have a lasting effect:

| Tenet | Effect |
|-------|--------|
| Peace | +10% reputation gains; realms holding devoted towns warm to you 50% faster |
| Charity | +20% conversion, +0.5 karma/day, but −25% tithes |
| Wisdom | +10% research speed |
| Justice | each devoted town gives its realm +1 stability (up to +3) |
| Valor | +5% battle power, −10% casualties |
| Humility | −10% army upkeep, +0.3 karma/day |
| Prosperity | +25% tithes, +5% property income |
| Nature | +15% farm yields |
| Sovereignty | +5% negotiation with lords; devoted realms warm to you twice as fast |
| Mysticism | miracles cost 20% less karma |

**Influence** (followers ÷ 100) has diminishing returns — 100 influence is half its full effect. It adds up to +50% conversion and +50% tithes. Buildings, sermons and Missionary colonies also win over a **share of each town** (shown as "reached" and "devoted" in the Religion panel). A town where at least 25% follow you is **devoted**: you get 5% better prices there, it spreads the faith to settlements within 3 hexes (faster with more influence), and its realm's regard for you rises by 0.1 a day per devoted town (at most +0.5 a day, up to 50). Realms with a zealous faith (militancy 3, e.g. the Iron Creed or the Stormfather) resent it instead: −0.05 a day per devoted town, down to −30.

### Religious Buildings

| Building | Cost | Build Time | Faith/Day | Influence Radius | Special |
|----------|------|-----------|-----------|-----------------|---------|
| Shrine | 300g | 3 days | 5 | 3 hexes | — |
| Temple | 1,000g | 12 days | 15 | 5 hexes | — |
| Monastery | 800g | 9 days | 10 | 4 hexes | +2 karma/day |
| Cathedral | 2,500g | 16 days | 30 | 8 hexes | +3 karma |
| Oracle Tower | 1,200g | 10 days | 12 | 6 hexes | +5 scholarship (+10% research speed) |
| Pilgrim Hospice | 600g | 5 days | 8 | 3 hexes | 3–9 pilgrim gold/day |
| Sacred Grove | 500g | 4 days | 7 | 4 hexes | +1 karma |
| Reliquary Vault | 1,500g | 12 days | 20 | 5 hexes | +1 renown/day |

### Faith Spreading

Every finished religious building draws its **Faith/Day** in pilgrims as new followers each day, and converts settlements within its influence radius at 1% × (1 + Faith × 0.1) × (0.5 + Faith/Day ÷ 20) of their population per day — a Shrine converts at 0.75×, a Temple 1.25×, a Cathedral 2×. As followers accumulate, your religious influence grows.

Special yields, applied daily once construction is done:
- **Pilgrim Hospice** — 3 gold/day, rising to 9 as the hospice gathers followers (+1× per 500, max 3×).
- **Reliquary Vault** — +1 renown/day.
- **Oracle Tower** — each scholarship point is 2% of a research day; the oracles' insight (banked up to 5 days) speeds your current research.

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
| Blessing of Prosperity | 15 | Double property income (gold and goods) for 5 days |
| Divine Protection | 20 | 3 days: no battle casualties and no personal damage |
| Mass Conversion | 25 | Gain 1,000 followers instantly |
| Bountiful Harvest | 12 | Triple farm production for 3 days |
| Divine Smite | 30 | Strikes the nearest hostile unit within 3 hexes for 35–50 strength: destroyed outright, or left with at most 40% if too strong |
| Revelation | 18 | Explore and reveal every tile within 10 hexes |
| Holy Sanctuary | 22 | 5 days: hostile units will not hunt or attack you within 3 hexes of where it was cast |
| Resurrection | 40 | Restore your most recently fallen military unit (the last 10 battle casualties are remembered) |
| Divine Plague | 35 | A settlement on or next to your tile, not of your realm or colonies, loses 30% population; costs −25 reputation with its kingdom and a further −10 karma |

Targeted miracles (Smite, Resurrection, Plague) check for a target first; with none, nothing is spent.

### Pilgrimages

Travel to holy sites scattered across the world to receive gold, karma, and renown rewards. There are **12 types** of holy sites, from Sacred Springs to Grand Reliquaries.

### Heresies

Heresies can emerge within faiths, reducing unity and stability. There are 11 heresy types that spread at varying rates — some benefit scholarship at the cost of faith unity.

**Denounce Heresy** (2 AP) appears in any town whose kingdom has an active heresy. Your sermon knocks 6 + 1.5×faith + 0.5×charisma (+0–4) off the strongest heresy's strength. Drive it to zero and the heresy is suppressed: the kingdom regains 5 piety and you earn +5 reputation there, +5 karma and +5 renown. Suppressions count toward the Heresy Hunter quest and achievement.

### Kingdom Temples

Pious lords fund chapels, monasteries and cathedrals. Besides piety, gold and scholarship, each adds half its unity bonus to the realm's faith unity (chapel +1.5, monastery +2.5, cathedral +5; at most +15). Unity feeds kingdom stability.

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

### What Techs Do

Beyond production and military bonuses, techs now affect: research speed (Writing, Printing Press), daily interest on your gold and cheaper loans (Banking Systems), battle casualties (Surgery), caravan speed and profit (Trade Networks), exploration finds at sea (Navigation), tavern income and purchase prices (Currency Minting), spy mission success and sight (Espionage), building costs (Stonecutting), defense when ambushed (Fortification), sight radius (Cartography), your colonies' growth (Aqueducts, Herbalism, Plague Prevention) and cultural building output and colony loyalty (Philosophy, Printing Press).

### Tech Buildings

| Building | Effect |
|----------|--------|
| Granary | Your farms within 1 hex +20%; half the losses from droughts and floods |
| Watchtower | Keeps everything within 4 hexes visible |
| Merchant Guild | +10% to all trade profits (up to 3 halls) |
| Shipyard | Ships docked beside it repair 5% a day, free |
| Lighthouse | +15% on cargo sold at a port beside it |
| Hospital | Heal 15 health a day within 2 hexes |
| University | Research 25% faster (up to 2) |
| Windmill / Water Mill | Grind grain into flour (Water Mill also saws firewood) |

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
| Crossbow | 2 | 250g | 8 | +25% ranged piercing (× archer share of your army), unlocks Crossbowman |
| Siege Engineering | 3 | 350g | 12 | Unlocks Siege Engine |
| Fortification | 3 | 300g | 10 | +30% defense, unlocks Watchtower |
| Heavy Cavalry | 3 | 350g | 12 | +35% cavalry strength, unlocks Heavy Cavalry |
| Plate Armor | 3 | 400g | 14 | Enemies strike 15% weaker; 15% fewer battle deaths |

#### Infrastructure 🛤️
| Tech | Tier | Cost | Days | Effect |
|------|------|------|------|--------|
| Road Building | 1 | 150g | 6 | Unlocks Dirt Roads |
| Paved Roads | 2 | 300g | 10 | Unlocks Stone Roads |
| Bridge Construction | 2 | 250g | 8 | Unlocks Bridges; halves the river-fording penalty (+2 → +1) |
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
| Shipbuilding | 1 | 200g | 8 | Unlocks Shipyard; fleet limit 3 → 6 ships |
| Navigation | 2 | 250g | 10 | Ships sail 30% faster; +25% exploration finds |
| Deep Sea Fishing | 2 | 150g | 6 | +40% fish from wharf boats and Fishing Fleets |
| Lighthouse | 2 | 250g | 8 | +20% port trade |
| Naval Warfare | 3 | 350g | 12 | +30% naval combat, unlocks Warship |

#### Medicine 💊
| Tech | Tier | Cost | Days | Effect |
|------|------|------|------|--------|
| Herbalism | 1 | 100g | 5 | +10% population growth, +15% plague resistance |
| Surgery | 2 | 250g | 10 | −20% battle casualties; 30% of the fallen survive wounded |
| Plague Prevention | 2 | 300g | 10 | +40% plague resistance |

A plague over your tile costs you health and soldiers each day; one over your colonies kills 2% of their settlers and 2 loyalty a day. Plague resistance cuts all of it.
| Hospital | 3 | 400g | 14 | +25% population growth, unlocks Hospital |

While a **Plague Outbreak** rages over the realm you stand in, you lose 6 health a day and each soldier has a 4% daily chance to die. Plague resistance (Herbalism + Plague Prevention = 55%, max 90%) cuts both by that share.

#### Culture & Learning 📚
| Tech | Tier | Cost | Days | Effect |
|------|------|------|------|--------|
| Writing | 1 | 100g | 5 | +10% research speed |
| Philosophy | 2 | 200g | 8 | +15% stability, +20% culture |
| Espionage | 2 | 250g | 10 | +25% intrigue, unlocks spy recruitment |
| Diplomacy Mastery | 3 | 300g | 10 | +30% effective diplomacy; tribute and peace cost 20% less |
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

A caravan whose start and destination are joined by roads (the world's roads or ones you build) is **road-linked**: it earns **+15%**, its wagon moves one extra hex a day (a timer-only caravan arrives in two-thirds of the time), and road wardens drive off half of the robbers who come for it. Roads also halve weather travel penalties.

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
| Counter-Espionage | 75g | 1 | 20 days | 10% | +30% daily chance to expose rival plots; doubled for holdings within 3 hexes of where the spy is posted, which also get a 30% chance to foil the plot on its strike day |
| Steal Technology | 200g | 2 | 12 days | 30% | Copy a tech from another kingdom |
| Sabotage Operations | 250g | 2 | 10 days | 25% | 10% treasury drain; the kingdom's settlements lose 15% of their gold and goods output for 20 days |
| Incite Rebellion | 350g | 3 | 15 days | 35% | 15% treasury, uprising in target kingdom |
| Assassination | 500g | 4 | 8 days | 40% | Kill a key figure; −75 diplomacy, −25 karma |

Failed missions risk spy capture (5–30% depending on mission). Captured spies are lost permanently.

### Loyalty

Spy loyalty starts at 45–90 and decays at 0.1/day. Below 20 loyalty, there is a risk of betrayal. Pay bonuses or complete successful missions to maintain loyalty.

---

### Consequences

- **War risk:** hostile missions list a war risk. If your spy is **caught**, the target kingdom sends you an **ultimatum** with that chance (a quarter of it on a quiet success): pay tribute by the deadline or face war. Kingdoms you're sworn to, or already at war or truce with, won't send one.
- **Incite Rebellion** knocks 20 points off the realm's stability (30 on a critical success), and keeps draining it each day the rising lasts.
- **Traits:** an Alchemist adds +15% success on assassinations; a Court Insider adds +10% when stealing technology.
- **Critical successes** earn half again the renown and raise the spy's loyalty by 5.

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

### Crew

Every ship needs sailors (its **crew** stat). New and used ships come **without a crew** — hire sailors at a port from the ship's management panel (12g each to sign on) and pay them **1g per sailor per day** on top of the ship's upkeep.

- **Short-handed ships** sail slower (50% speed with no crew → 100% fully crewed; at sea each hex costs 2–4 stamina), fight worse (40% → 100% of combat strength) and haul fewer fish with Deep-Sea Nets.
- Below a **skeleton crew** (a quarter of the crew stat) a ship cannot leave port.
- **Morale** rests at 70 and scales combat strength (+15% at 100, −35% at 0). Storms at sea shake it and can wash a sailor overboard; a sea fight won lifts it (and may cost a sailor), a defeat costs 10–25% of the crew and a big morale hit. Paid crews recover toward 70, faster in harbour.
- **Missed wages** (not enough gold) cost 15 morale a day; below 25 morale, 10% of the crew deserts each day.
- Ships from older saves keep a full crew at morale 70.

Tunables live in `data/ships.json` → `settings.crew`.

### Naval Travel

Board your ship at coastal settlements to traverse oceans. Sea movement costs 2 stamina per tile with a full crew (more when short-handed). Random exploration events can occur at sea: floating cargo, uncharted islands, sea monsters, pirate ambushes, and more.

### Landing Ashore

You don't need a port to go ashore. While aboard, **Row Ashore** (4 AP) lets you row the ship's boat to any walkable land hex next to the ship; the ship drops anchor and waits offshore. Stand next to it and choose **Row Out to Ship** (4 AP) to go back aboard. You can also **Disembark** directly onto a beach or a coastal settlement.

Cargo is limited by where you land. A **port** — a settlement on the water — unloads the whole hold into your inventory. Anywhere else (open shore or a beach) the ship's boat ferries only **5 cargo per day**; whatever doesn't fit stays in the hold.

### Ship's Hold

Use **Ship's Hold** (free) to load goods from your pack into a ship, or unload them, while the ship is docked on your hex or anchored next to you. You can't shift goods between pack and hold while aboard. Each ship's hold is capped by its cargo capacity (plus Cargo Hold upgrades). At a port transfers are unlimited; elsewhere they share the boat's 5-per-day allowance with whatever came ashore when you landed. Anchored and docked ships are shown on the world map (⛵, with ⚓ when anchored).

### Ship Trading

A used ship market exists at settlements with variable condition (40–85%) and discounted prices.

### Port Markets

With a ship docked at a port, **Port Market** (free) buys trade goods — spices, silk, wine, iron, ivory, gems, timber, fish — straight into its hold, and sells them out of it. Every port has a role for each good:

- **Exports** — cheap to buy, but the port pays little for it.
- **Imports** — the port doesn't sell it but pays a premium.
- **Local market** — buys and sells in between.

Roles are fixed per port; prices drift every 7 days. Buy where a good is exported, sail, and sell where it's imported — the hold's cargo capacity caps how much each run carries.

**Blockaded ports.** While an enemy fleet blockades a realm's ports (see [Royal Fleets](#royal-fleets)), its port markets charge 25% more and pay 20% less. If the blockading fleet is at least three times the realm's own, the harbour is **closed**: nobody buys or sells until the blockade is broken.

### At Sea

While aboard on open water you can:
- **Explore the Waters** (6 AP) — wrecks, uncharted islands, storms and sea monsters.
- **Hunt Pirates** (10 AP) — win for a gold bounty, +3 renown and +2 karma; lose and the ship and crew take damage.
- **Turn Pirate** (10 AP) — plunder merchant ships for gold at the cost of karma, renown and reputation with every kingdom.

### Royal Fleets at Sea

Kingdoms keep fleets (see [Royal Fleets](#royal-fleets)), and a hostile one guards its waters. A ship of yours that is at sea, sailing or at anchor within **3 hexes of a port** of a hostile realm may be stopped by a squadron of its fleet. A realm is hostile if it's at war with you or with your liege (12% chance a day), or if your reputation with it is −50 or worse (4% a day). Ships docked in a harbour are safe. Your liege's fleet never stops you.

The squadron is about 30% of the realm's fleet (6–60 strength). Your ship fights with its own strength, which counts hull condition, crew and morale, plus your **war-galley escort**. A short-handed ship with no galleys rarely gets away.

- **Win:** +2 renown, a few sailors may be lost, and the realm's fleet loses half the squadron. Against a realm at war with you, you also gain +10 war score.
- **Lose:** the hull takes 8–20% damage, 10–25% of the crew is lost, and the squadron seizes 30% of every good in the hold.

---

## 16. Kingdoms & Diplomacy

### The World's Kingdoms

The game features **10 kingdoms**, each with unique culture, traits, and territory preferences:

| Kingdom | Culture | Traits | Preferred Terrain |
|---------|---------|--------|------------------|
| Kingdom of Valdoria | Imperial | Militaristic, Orderly | Plains, Grassland |
| Kingdom of Sylvaris | Woodland | Peaceful, Nature-loving | Woodland, Seasonal & Temperate Rainforest, Grassland |
| Khanate of Kharzun | Nomadic | Aggressive, Mobile | Plains, Desert |
| Theocracy of Azurath | Religious | Religious, Scholarly | Desert, Hills |
| Republic of Merathis | Maritime | Mercantile, Naval | Coast |
| Holds of Durheim | Mountain | Defensive, Industrious | Mountain, Hills, Highlands, Tundra |
| Dominion of Miregloom | Swamp | Secretive, Alchemical | Swamp, Tropical Rainforest, Woodland |
| Conclave of Luminara | Arcane | Scholarly, Arcane | Hills, Plains |
| Jarldom of Frostmark | Nordic | Aggressive, Seafaring | Tundra, Mountain, Boreal Forest, Coast |
| Sultanate of Ashkari | Desert | Mercantile, Resilient | Desert, Savanna |

A realm expands into its preferred terrain first and fights 8% better on it.

**Traits** (data/kingdoms.json → `traitEffects`) add to the realm's bonuses: Militaristic +10% army, +5% battle · Orderly +6 stability, +10% intrigue · Peaceful +25% diplomacy, +3 stability, −5% army · Nature-loving +10% growth, +10% faith · Aggressive +8% battle, −15% diplomacy · Mobile +20% expansion, +15% endurance · Religious +30% faith, +6% loyalty (and sends Missionary colonies) · Scholarly +25% research, +10% culture · Mercantile +20% trade, +5% treasury · Naval +10% trade, +5% defense · Defensive +15% defense, −10% war upkeep · Industrious +25% construction, +5% treasury · Secretive +25% intrigue, −5% diplomacy · Alchemical +5% growth, +10% research · Arcane +20% research, +4% battle · Seafaring +10% expansion, +8% trade · Resilient +30% endurance, +4 stability. Mobile realms field more cavalry; naval, seafaring and nature-loving ones more archers; orderly, defensive, religious and militaristic ones more pikemen.

### Royal Fleets

Every kingdom with **ports** (settlements next to water) keeps a royal fleet:

- **Size.** A realm can keep 10 fleet strength afloat per port, plus 5 if its capital is a port. Naval realms get ×1.5, seafaring ones ×1.4 and mercantile ones ×1.15. A realm never keeps more than its treasury can back (1 point per 120 gold). A realm without ports has no fleet.
- **Cost.** New ships cost 25 gold per point of strength, and the fleet grows by about 5% of the gap each day. Upkeep is 0.3 gold per point a day, paid from the treasury. A fleet the realm can't pay loses 5% a day, and ships beyond the cap (when ports are lost) are laid up.
- **Battles at sea.** In a war between kingdoms, the two fleets meet on about one day in seven. The loser loses 20% of its fleet and the winner 8%.
- **Blockade.** A fleet of 8+ strength that is at least 1.25 times the enemy's blockades the enemy's ports for as long as it keeps that edge. While blockaded:
  - The realm's income falls by up to 25%, scaled by the share of its settlements that are ports.
  - Attackers storming one of its ports fight 12% harder.
  - Its port markets trade at worse prices, or close entirely (see [Port Markets](#port-markets)).
  - The blockade lifts when the blockading side's edge is gone or the war ends.

A realm's fleet strength, cap, ports and any blockade show in its kingdom panel, in the Dynasties panel, and for each war in **Wars of the Realm**. Tunables live in `data/military.json` → `kingdomNavy`.

### Reputation

Your reputation with each kingdom ranges from very hostile to allied. It changes based on your actions:
- **Positive**: Completing contracts, donating to the poor, diplomatic actions, quests.
- **Negative**: Raiding settlements, conquest, smuggling (if caught), assassination.

### Diplomacy

Your **effective diplomacy** is your Diplomacy skill plus your House Chancellor's bonus. Each point:
- adds **+5% to every reputation gain**: gifts to lords, tribute, donations, settled fines, trade agreements
- adds **+2% to the chance of success** when negotiating trade agreements or requesting aid from a lord

A House Chancellor's bonus also counts toward the diplomacy requirements of royal offices.

### Allegiance

You can **Pledge Allegiance** to any kingdom at their capital, becoming a citizen. This opens access to titles, tax collection, and royal offices. You can only be allegiant to one kingdom at a time. **Renounce Allegiance** to become a free agent again (costs reputation).

### Wars Against You

Kingdoms don't only fight each other. A kingdom's **hostility** toward you is your reputation with it, negated (a −50 reputation counts as +50), plus its rival House's feud if it has one. Your liege kingdom is never hostile.

Every 10 days, if you own at least one property or colony, a kingdom with hostility of 80 or more may issue an **ultimatum**: pay tribute (300 + half its military) within 10 days, or it declares war. Paying earns you +20 reputation and a 60-day truce.

**At war**, the enemy sends **war hosts** (🚩 on the map) every 12 days, at most two at a time. Each host's strength is 20 plus 4% of the kingdom's military, between 25 and 180. Hosts march on whichever of your holdings lies closest to one of the enemy's settlements:

- A **property** at level 2 or higher is sacked: it loses a level and its stored goods, and stops producing for 20 days. A level-1 property is burned to the ground.
- A **colony** is besieged. If the host is stronger than the garrison, the colony is stormed and joins the enemy kingdom. If the garrison holds, the colony loses 10 loyalty.

A war host attacks you when you're next to it, and you can attack it yourself. Breaking a host gives +30 war score and Prestige. Each holding you lose costs −20 war score, and a colony that holds out gives +10.

**Ending the war**, from Dynasty → House → Wars & Ultimatums:

- **Buy peace.** 200 + 40% of the enemy's military, minus 10 gold per point of war score (at least 100).
- **Demand peace.** Needs a war score of 50 or more. The enemy pays you reparations (100 + 20% of its military), and you gain Prestige.
- **Exhaustion.** After 150 days with no host in the field, the war ends by itself.
- **The enemy falls.** If its kingdom is destroyed, the war ends.

A 120-day truce follows any peace.

### Kingdom AI

Kingdoms are run by AI with distinct personalities, set by their traits: **Aggressive** (expands and declares war most, sometimes recklessly), **Militaristic** (a 15% larger standing army that rebuilds 50% faster; declares war only when at least as strong as the target, and is half as quick to sue for peace), **Peaceful**, **Mercantile** and **Balanced**. The Dynasties panel shows each realm's traits and temperament. They:
- Expand territory and found new settlements.
- Wage wars against rivals.
- Form and break alliances.
- React to your influence and actions.
- Have rulers with 30+ possible traits affecting their behavior (Brilliant Strategist, Cruel, Ambitious, etc.).

**Kingdom bonuses.** A realm's strengths combine three sources: its ruler's traits and skills plus its advisors (general, treasurer, chancellor, court physician, …), its NPC lord's personality numbers, and its culture tradition. Together they set army size and battle power (military, battle, defense), income (treasury, stewardship, taxes), war upkeep, how often it expands, founds villages and opens trade routes, diplomacy, piety, scholarship and cultural influence, advisor loyalty, heir births, and how often the ruler falls ill. Scholarship, influence and running cultural events add their own small bonuses on top (see [Culture](#19-culture)). The Dynasties panel lists a kingdom's combined bonuses.

**Stability (0–100).** Every kingdom has a stability score that drifts each day toward a target: 60, plus ruler/lord/tradition stability and loyalty, plus world events (rebellions −25, succession crises −20, royal weddings +10, festivals +5, …) and the realm's mood, minus 5 per war and 15 for an empty treasury, adjusted by faith unity. High stability raises income by up to +20% and steadies troops in battle; low stability cuts income (down to −50%) and saps morale. Below 35 the realm is restless and may erupt in a **Peasant Rebellion** (a cunning spymaster lowers the odds). Stability shows in the kingdom info panel and the Dynasties panel.

### Wars Between Kingdoms

Kingdom wars are fought for **goals**, not to the last man:

- **Campaign season.** Realms declare war most in summer (×1.5) and autumn (×1.2), less in spring (×0.8) and least in winter (×0.5). Bold and reckless rulers are bolder in summer.
- **Pace.** A war sees a pitched battle about one day in three, fought over a border tile. Towns are defended at +25% and the capital at +50%. Taking a town counts triple toward the war goal.
- **Armies persist.** Losses stick; a realm's army rebuilds about 4% of the way back to what its land can support each day, and sheds men quickly when land is lost.
- **How wars end.** When an aggressor reaches its war goal (3–8 tiles), the loser sues for peace and pays **20% of its treasury in tribute**. A badly outmatched side may sue early, and long wars end in a truce from sheer weariness.
- **Truces.** Peace brings a **180-day truce**: neither side may declare war again until it runs out. A realm already fighting two wars won't open a third.
- **Falling and rising.** A realm falls only when its **last town** does; if its capital is taken, its court flees to its largest remaining town. A fallen realm's old towns remember it: unless the occupier's realm is content (stability 75+), each old town has a small daily chance to throw off its rule and **restore the old kingdom**. The chance grows as the occupier's stability falls, and the restored realm goes straight to war with its occupier.

**Wars of the Realm** (at any settlement, while a war or truce is on) lists every war with both sides' progress toward their goals, the truces in force, and the fallen realms. From there you can:

- **Broker peace** (50g, 2 AP) at a town of either side. The chance rises with your diplomacy and renown, and falls if a side is close to its goal. Success earns +8 renown and reputation with both crowns; failure means both courts refuse your envoys for 10 days.
- **Broker an alliance** (100g, 2 AP) at a town of either crown, for two kingdoms at peace, not yet allied, with mutual relations of 30+. The chance rises with your diplomacy, renown and how warm the two crowns already are. Success makes them allies (relations to at least 75), earns +10 renown and +5 reputation with both, and counts toward the Alliance Broker quest; failure means a 15-day wait.
- **Join the campaign** (2 AP) while your liege is at war: you fight an enemy vanguard of about 6% of its army. Each victory pays 30g, raises your standing with your liege, weakens the enemy and pushes your liege toward its war goal. When your liege wins, you get a share of the tribute (10% per victory, up to half) plus gold and renown.

- **Send your galleys to the fleet** (free) while your liege is at war and you have war galleys. Half of your squadron's strength sails with your liege's fleet and counts in its sea battles and blockades. Each galley earns 4g a day from your liege, and each sea battle the fleet wins counts as a campaign victory toward your share of the tribute. When the fleet loses a battle, one of your galleys is damaged for 5 days. While they serve, the galleys don't escort your own ships. They return when you recall them, when your liege makes peace, or when you leave its service.

**Your liege's wars follow you to market:** in towns of a realm at war with your liege, prices are 15% worse; in towns of its allies, 5% better.

**Restore a fallen realm** (in one of its old towns, 2 AP): fund a rising for 300–1,200g depending on the town's size. The chance is 35%, +25% if the occupier is restless, +3% per point of stealth. Success restores the kingdom there: +20 renown, +40 reputation with it, −30 with the occupier. Failure loses the gold, and the occupier may find out who paid. You can't fund a rising against the realm you're sworn to.

### NPC Lords

AI-driven lords roam the world with personality traits (Ambitious, Honorable, Cruel, Cunning) that drive their decisions. You can encounter them on the map and request meetings. Each trait's numbers feed their kingdom: a Builder founds villages and repairs damage faster, a Tyrant taxes harder but erodes stability, a Warmonger wins more battles but makes enemies, a Paranoid lord holds his walls. Pious lords weigh your karma heavily, and a lord counts you as kin while you're married into his realm.

**Goals.** Every trait gives its lord one or two goals (set in `data/npcLords.json`), each with a priority. A lord with several traits pursues all of their goals; a goal that two traits share keeps the higher priority.

| Trait | Goals |
|-------|-------|
| Ambitious | Expand, Conquer, Colonize |
| Expansionist | Expand, Colonize |
| Greedy / Merchant | Wealth, Trade |
| Cunning / Scholarly | Trade, plus Alliance (Cunning) or Peace (Scholarly) |
| Pious | Faith, Peace |
| Zealous | Faith, Domination |
| Honorable / Just | Alliance, Justice |
| Brave | Conquer, Justice |
| Cruel / Tyrant | Domination, Fear |
| Ruthless / Warmonger | Domination, Conquer |
| Diplomat / Generous | Alliance, Peace |
| Cautious | Survive, Alliance |
| Paranoid | Survive, Fear |
| Builder | Expand, Survive |
| Isolationist | Survive, Colonize |
| Hedonist | Wealth |

Each day a lord works on each goal with a chance of about 30%. High priority counts in full, medium ×0.75 and low ×0.5. Ambition changes the chance by ±25% and intelligence by ±15%. Some goals also have **standing effects** that apply every day, scaled by priority:

- **Trade:** his factors work the markets. The treasury gains 4 gold per town, 1 per trade route and ½ per road tile (up to 20 roads), scaled by stewardship. Relations with one trading partner rise by 3 on both sides.
- **Faith:** piety +2. Sometimes he also funds a temple: a chapel for each town, up to two monasteries, and a cathedral once the realm has three towns. He never spends more than a third of the treasury on one. Temples keep adding a little piety, tithes and (monasteries) scholarship every day. *Standing:* +3 stability.
- **Justice:** his wardens hunt a band of brigands on his land. *Standing:* +5 stability, a 50% chance that a new bandit band forming on his land is put down at once, and he keeps every truce 45 days longer.
- **Domination:** he leans on the weakest realm that is not an ally, not at war with him and not under a truce, provided its army is under 70% of his. Relations drop by 3 on both sides. If its army is under half of his, he may cow it into paying 3% of its treasury as tribute. Now and then he weighs war through the normal war system. *Standing:* +10% standing army and a larger war appetite.
- **Fear:** he rules by the sword. When stability falls below 35, his soldiers crush dissent (+3 stability now). Each time, one neighbour trusts him 2 points less. *Standing:* +8 stability.
- **Survive:** at war, he sues for peace when his army is smaller than the enemy's or the war has lasted more than 90 days (35% each time he tries). At peace, he banks 3 gold per town. *Standing:* +10% defence in battle and 20% lower war upkeep.
- **Expand / Wealth / Conquer / Alliance / Peace:** claim border land, set up trade routes, weigh war, warm a neighbour, or make peace.
- **Colonize:** sometimes sends **his own realm's** pioneers to distant wilderness. The usual limits apply: at least 300 gold and 100 soldiers, at most two parties out and five colonies.

**Character.** A lord's 1–10 stats matter too:

- **Honor:** keeps truces up to 45 days longer, or lets them lapse up to 45 days early, which is the commonest betrayal. An honorable lord stands by allies until relations fall below 15; a faithless one drops them below 45 (the usual point is 30). Honor also lowers his appetite for war.
- **Ambition:** how hard he pushes his goals, and how strong he must feel before declaring war (±15%).
- **Intelligence:** how well his efforts pay off, and how well his envoys do in diplomacy.
- **Stewardship:** ±10% on his kingdom's daily income, and ±25% on the gold his trade and savings bring in.

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

Each title comes with unique perks — the Tax Collector earns 15–40g per collection, the Marshal gets −15% military costs, and the Chancellor receives +25% salary bonuses on all other titles and +10% on taxes from settlements you rule.

Failing to fulfill your duties risks demotion.

---

## 18. Relationships & Dynasty

### Spending Prestige

Prestige is your House's standing — gold can't buy what it does. It is the only prestige counter: older saves' "dynasty prestige" is folded into House Prestige on load, and an heir succeeding you earns the House +5. From the House panel:

| Action | Cost | Effect |
|--------|------|--------|
| Press a Claim | 15 | Take the next office in your kingdom when only reputation or renown stands in the way (skills still count) |
| Arrange a Prestigious Marriage | 10 | A noble of the settlement, already fond of you, joins those you can court. Marrying a noble: +10 renown, +15 reputation with their kingdom, and Prestige |
| Call in a Favor | 8 | An allied House sends gold (150 + 75 per generation) or +15 reputation with a kingdom |
| Secure Succession | 20 | Bypass a succession crisis and install your chosen heir |

### Rival Houses and Their Schemes

Three powerful Houses are your rivals from the start. If one of their kingdoms falls, another House rises to take its place. Each rival holds a **feud** with you (0–100), and the feud grows when you:

- conquer one of their settlements (+25)
- raid one of their settlements (+10, or +5 if the raid fails)
- get caught spying on them (+10 if your spy is captured, +4 for a successful mission they notice)
- simply rise (every 30 days): 1, plus 1 per 30 Prestige, plus 1 per 4 working properties, plus 1 per colony, plus 1 if you hold an office, up to 6

Feud cools by 1 every 30 days.

Every 20 days, the angriest rival without a plot already running may hatch a **scheme**. The chance is its feud ÷ 120, and no more than two schemes run at once. A scheme strikes 8–15 days after it is hatched:

| Scheme | Feud | Target | Effect if it lands | Guard (cost, odds) |
|--------|------|--------|--------------------|--------------------|
| 🗣️ Slander | 10 | Your name | −8 reputation with every kingdom, −5 renown | Cannot be guarded |
| 💰 Treasury Theft | 20 | Your gold (200+) | Lose 8–15% of your gold (max 2,000) | Vault guards, 40g, 80% |
| 🔥 Sabotage | 20 | A property | No production for 12 days | Watchmen, 30g, 75% |
| ⚔️ Raid | 40 | Your best property | Stored goods taken, −1 level, no production for 20 days | Garrison, 80g, 70% |
| 🔥 Incite Unrest | 35 | A colony | −20 colony loyalty | Garrison, 60g, 80% |
| 🗡️ Assassination | 65 | Your heir or a child | 50% they die, otherwise they are wounded | Bodyguards, 100g, 85% |

Schemes are **hidden** until uncovered. Each day there is a chance to expose each one: 6% base, +12% with a Spymaster appointed, +3% per idle spy and +30% while a counter-espionage mission is running (+60% for a plot aimed at a holding or colony within 3 hexes of the posted spy, which may also be foiled on the strike day). A successful counter-espionage mission exposes every plot at once. A plot you never uncover strikes without warning.

Once a plot is uncovered, open **Dynasty → House → Plots Against You** to respond:

- **Guard the target.** Pay gold. The guards stop the scheme on its strike day at the odds in the table.
- **Send a spy.** An idle spy tries to break the plot, succeeding 35% of the time plus 10% per spy level. You get one try per plot, and a failure costs the spy 10 loyalty.
- **Buy them off.** Pay 150 gold + 10 per feud point, or 10 Prestige + 1 per 10 feud. The plot is cancelled and the feud drops by 15.

When a scheme lands, the rival's feud drops by 10 (their grudge is partly satisfied). When you foil one, it rises by 5.

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

### Townsfolk: Disposition, Threats and Secrets

Every person you talk to on a settlement map remembers you (the disposition bar in the dialog), and it has real effects:

- **Prices** — see *Trading with townsfolk* in §4.
- **Gifts** build a habit of goodwill: each gift makes later disposition gains 10% larger (up to +50%). Three gifts to someone you threatened make amends.
- **Intimidate** — on success the NPC hands over coin (once per person: merchants 20–60g, nobles 30–80g, villagers 3–12g). Either way they become afraid of you, warm to you at half speed, charge you more, and may run to the guard (25% after a successful threat, 45% after a failed one; more if bold or stern), which spreads an assault rumour. Below 15 disposition they won't talk at all — only a gift or goodbye.
- **Persuade** (Warm+) — one real secret per person: a sketch map that reveals unexplored land 5–10 hexes away, a treasure map, a hidden cache of gold, true numbers on the kingdom's army, treasury and wars, or (traders) a permanent 15% discount.
- **Titles** — gain a title and people who knew you congratulate you (+5 disposition, once).
- **Harming people** — attacking someone sours their spouse, children, parents and siblings toward you (killing them far more: up to −63), and close friends too. Grieving relatives hold a grudge and greet you with it, and the family's bonds with each other grow stronger.
- **Night** — from 9 PM to 5 AM most townsfolk go home (travelers to the tavern) and stay in; guards keep patrolling.

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
| Gift | Interested | 0–100g | by gift |
| Serenade | Flirting | Free | 4–10 |
| Romantic Dinner | Courting | 50g | 8–15 |
| Propose | Courting (70+ affection) | 100g | 15–25 |

Gifts come from a list — Wildflowers (5g), Silver Necklace (50g), Gold Ring (100g), Written Poem (free, helped by intelligence), Fine Blade (80g) and Rare Book (40g). Pricier gifts win more affection, and each personality has favourites worth half again as much (bold and stoic types love a blade; witty ones a poem or book).

**Marriage benefits** (from `data/relationships.json`): +1 stamina, +10 social, +5 reputation with your spouse's kingdom, +3 renown, and kinship: that kingdom's lord thinks better of you (+20 opinion) for as long as the marriage lasts.

### Children & Heirs

- Children can be born each year (25% probability).
- Each child receives a random trait: Gifted (+1 all), Strong (+2 STR), Clever (+2 INT), Charming (+2 CHA), and others.
- Maximum 6 children. Designate one as your **heir**.
- Heirs become playable at age 16 if you die, inheriting 75% gold, 50% renown, and 30% reputation.

---

## 19. Culture

### Cultural Buildings

| Building | Cost | Build Time | Effect (level 1) |
|----------|------|-----------|--------|
| Scriptorium | 400g | 4 days | +10% research speed, 1 gold/day |
| Library | 600g | 6 days | +15% research speed, 1.5 gold/day |
| Theater | 800g | 8 days | +2% army morale, 2.5 gold/day |
| Monument | 1,000g | 10 days | +1 renown/day, 2 gold/day |
| University | 1,500g | 14 days | +30% research speed, 4 gold/day (requires 1,000 pop) |

Effects start once construction finishes. **Research speed** from Scriptoria, Libraries and Universities adds up (capped at +50%) and shortens every technology you start researching, on top of INT, Writing/Printing Press and University properties. **Income** is a tenth of the building's culture rating per level per day (Philosophy and Printing Press multiply it); fractions carry over, so a Library pays 3 gold every 2 days. Theaters' morale bonus is capped at +6% across all of them.

**Upgrades.** Stand on one of your finished cultural buildings and choose **Upgrade** (3 AP) to raise it to level 2 for half its build cost, then to level 3 for its full build cost (a Library: 300g, then 600g). Each level multiplies income, renown and influence by the level (×2, ×3) and adds +50% to its research and morale bonus (×1.5, ×2). The hex info panel and the Culture overview show each building's level, real income and upgrade price.

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

These are real kingdom bonuses (shown in the kingdom info panel and Cultural overview): military/cavalry/archery/naval add army strength (cavalry and archery also shift the army's mix), raiding adds battle power, defense helps defenders, endurance resists attrition, trade/navigation/hospitality open trade routes, scholarship/research/magic raise scholarship, faith raises piety, mining adds treasury income, craftsmanship speeds construction, nature/alchemy help population growth, and stealth/poison add intrigue against rebels.

### Scholarship & Influence

Every kingdom has **Scholarship** and **Influence** (0–100). They grow slowly on their own, faster with scholarly traditions and rulers, and much faster with cultural buildings. They have real effects:

- **Scholarship** → up to +5% kingdom income (learned stewards) and +20% construction (repairs and founding villages).
- **Influence** → up to +3 relations per diplomatic envoy, and *cultural pull*: a realm's envoys warm by +1 per 20 points of influence the other realm has over it (max +3), so admired cultures make friends and fewer enemies.
- **Both** → stability: ±0.1 per point that their average sits above or below 40 (from −4 to +6).

The kingdom info panel and the Culture overview list each realm's current culture effects.

### Kingdom Cultural Buildings

Kingdoms commission their own cultural buildings (about once every three months, at most 3 per realm, one per town) when the treasury holds at least three times the cost. They are built over the usual construction time, then each adds 5% of its scholarship rating and 10% of its influence rating per day (a Library: +0.25 scholarship, +0.2 influence). If the town is conquered, the building passes to the conqueror.

### Cultural Events

13 event types can occur (about 1% per kingdom per day, paid from its treasury, lasting 3–7 days). While an event runs, its effect is real:

| Effect | Events | While running |
|--------|--------|---------------|
| Morale | Grand Festival, Great Horse Race, Harvest Feast, Gladiatorial Games | +0.2 stability target per point, +value/200 battle morale |
| Scholarship / Research | Book Fair, Philosophical Debate, Arcane Symposium | +value/10 scholarship per day |
| Influence | Art Exhibition | +value/10 influence per day |
| Renown | Bardic Competition | +value/40 diplomacy (+2 relations per envoy) |
| Industry | Forge Festival | +value% construction, +value/2 % income |
| Trade | Naval Regatta, Caravan Festival | +value% trade route chance, +value/2 % income |
| Faith | Spirit Walk | +value/10 piety per day |

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

**Missionary work.** A Missionary colony befriends tribes within 4 hexes (+0.05 relation a day) and converts them to its faith. If it is your colony and you have founded a religion, it spreads *your* faith: every settlement within 4 hexes gains a share of followers each day, and converted tribesfolk join your faith (2% of a tribe's people a day). The mother kingdom gains cultural influence and piety (+0.01 a day per colony, at most +0.05). The colony panel shows how far its missionaries reach. Religious kingdoms send Missionary colonies of their own.

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

The game features **42 quest templates** (plus artifact quests) across 5 categories with 4 difficulty tiers (Easy, Medium, Hard, Legendary).

### The Quest Board

Open the **Quest Journal** to see up to **5 offered quests** and press **Accept** to take one on (at most 5 active at once). Accepting refills the board. Offers are drawn from the whole catalogue, and harder tiers unlock as you prove yourself:

| Tier | Unlocks after |
|------|---------------|
| Easy | Always |
| Medium | 2 completed quests or 25 renown |
| Hard | 5 completed quests or 100 renown |
| Legendary | 10 completed quests or 300 renown |

Artifact quests appear as soon as you find a fragment of that artifact. Progress counts everything you've done since the start of the game — battles won, ruins explored, treasure dug up, roads built, taverns visited, trade revenue and so on — so a quest may complete the moment you accept it. Heresy Hunter counts heresies you suppress with Denounce Heresy; Alliance Broker counts alliances you broker from the Wars of the Realm panel.

### Favours for Townsfolk

Ask an NPC whether they need help and they may make a request. If you accept, it becomes a real quest in your journal (it counts toward the 5-quest limit). Only what you do **after** accepting counts: explore ruins, win battles, see a caravan through, hire an informant, visit settlements and so on, depending on the request. The reward depends on what they promised: gold, renown, karma, or forged weapons from a blacksmith.

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

### Timed Events

Some events last for days or weeks — droughts, plagues, floods, gold rushes, trade booms, market crashes, pirate surges, bandit uprisings, blizzards, hungry months and more (24 in all). Natural events follow the seasons: floods in spring, droughts in summer, bountiful harvests in autumn, blizzards and famine in the lean months. Each day there's a chance one begins, either in a kingdom (two kingdoms for wars and royal weddings) or across the whole realm; at most four run at once. The tile info panel lists the events affecting a tile, what they do, and how long they have left.

What the effects do:
- **Farm/mine output, prices, trade income, caravan traffic, raiders, pirates, ship upkeep** — your farms and mines, market prices, caravan and port profits, how many caravans/bandits/pirates appear (bandits gather near a troubled settlement), and your ships' daily upkeep.
- **Population** — a one-off loss when the event strikes. **Population growth / food consumption** — the region's settlements slowly grow or shrink while it lasts.
- **Buildings damaged** — the struck settlement produces less gold and goods until builders repair it (about 1% a day; faster with construction bonuses).
- **Tax income** — both the kingdom's income and the taxes you collect there.
- **Stability / morale** — move the kingdom's stability target; morale also shifts battle morale for kingdoms and for you (±0.2 at ±20).
- **Travel speed** — your daily movement while you're in the region. **Army attrition** — your army loses men each day it camps outside a settlement; kingdom armies shrink.
- **Diplomacy / relations, piety, heresy risk, war spending, renown from victories** — kingdom diplomacy drift, daily relation gains between wedded houses, the kingdom's piety, the daily chance of a new heresy, war upkeep, and extra renown for your victories.

### Natural Events
| Event | Severity | Effect |
|-------|----------|--------|
| Drought | Moderate | −40% farm output, −20% growth, +50% food prices, −5 stability |
| Plague | Severe | −15% population, −50% trade, −50% growth, −20 morale, −10 stability |
| Flood | Moderate | −30% farm output, −30% travel speed, 10% building damage |
| Earthquake | Severe | 25% building damage, −5% population, −15 morale, −5 stability |
| Volcanic Eruption | Catastrophic | −20% population, −60% farming, 30% building damage, −20% travel |
| Bountiful Harvest | Positive | +50% farm output, −30% food prices, +30% growth, +10 morale |
| Blizzard | Moderate | −50% travel speed, −20% farming, 10% army attrition |
| Hungry Months | Moderate | +40% food prices, −30% growth, −15% farming, −6 stability, −8 morale (lean months only) |
| Comet Sighting | Neutral | −5 morale, +1 piety/day, −3 stability (realm-wide) |
| Solar Eclipse | Neutral | −10 morale, +2 piety/day, −8 stability (realm-wide) |

### Economic Events
| Event | Severity | Effect |
|-------|----------|--------|
| Gold Rush | Positive | +60% mine output, +30% growth, +20% bandits, +15% taxes |
| Trade Boom | Positive | +40% trade income, +30% caravans, −15% prices |
| Market Crash | Moderate | −40% trade income, −20% taxes, −10 morale |

### Military Events
| Event | Severity | Effect |
|-------|----------|--------|
| Pirate Surge | Moderate | −50% sea trade, +60% pirates, +20% ship upkeep |
| Bandit Uprising | Moderate | +50% bandits, −30% land trade, −15 stability |
| Kingdom War | Severe | Two hostile kingdoms go to war (truce when it ends); +50% war spending, −10% population, −30% trade |
| Monster Sighting | Moderate | −15% travel speed, −10 morale, +50% renown from victories |

Smaller military news is reported too. **Training exercises** add up to 10% to a realm's army, but never more than the realm can feed (its cap). **Desertions** cost 10% of the army. **Recruitment drives** add 1% of the population, up to the cap. **Parades** raise stability a little.

### Political Events
| Event | Severity | Effect |
|-------|----------|--------|
| Peasant Rebellion | Moderate | −25 stability, −30% taxes, +40% bandits, −10 morale (also sparked by low stability) |
| Succession Crisis | Moderate | −20 stability, −30% diplomacy, −15% taxes, −10 morale |
| Royal Wedding | Positive | Two kingdoms: +15 relations at once and +3/day, +10 stability, +15 morale |
| Grand Festival | Positive | +20 morale, +20% trade, +5 stability |
| Refugee Wave | Moderate | +30% growth, +25% food consumption, −10 stability |

### Religious Events
| Event | Severity | Effect |
|-------|----------|--------|
| Religious Schism | Moderate | −0.5 piety/day, +30% heresy risk, −10 stability |
| Holy Crusade | Severe | +15 morale, +0.5 piety/day, −30% diplomacy |

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


### Doctored & Propaganda Maps

Some maps lie. A map with deliberate alterations, or a kingdom's wartime propaganda map, plants its falsehoods in your own picture of the world when you read it: **phantom towns, roads that aren't there, wrong terrain, and borders pushed into neighbours' land**. They're drawn faintly on hexes you can't currently see, and hex info shows "Your Map: Shows …".

- When you see the hex for yourself, the lie is **exposed** (you're told which map lied) and you gain a little cartography skill.
- Hexes you can already see can't be faked, and your own maps never fool you.
- If you **detect the alterations** when reading a map, none of its lies take hold. At cartography skill 6 or higher you may also spot individual alterations (15% per point above 5).
- Cartographers pay for maps by how trustworthy they are: low-accuracy and doctored maps sell for less.
- Kingdoms at war that publish propaganda maps gain +2 stability per map in circulation (up to +6).

### Royal Cartography (Kingdom Atlases)

Every realm keeps a royal archive (tuning in `data/cartography.json` → `kingdomAtlas`):

- A realm with 5,000+ gold in its treasury **appoints a court cartographer** (300g, then 2g/day; an empty treasury dismisses him). He draws a chart of a rival realm about every 45 days (faster under explorer rulers and scholarly courts), choosing enemies at war and uncharted or long-unvisited realms first. Propaganda maps count as maps drawn too.
- **Atlas skill** grows with the square root of maps drawn (+2 for an explorer ruler). It sets how accurate the realm's charts are (45% → 95%).
- **Charts win wars.** A realm fights up to +12% better against a realm it has an accurate chart of, and picks charted rivals as war targets.
- **Map Trader → Royal Archive** (towns and cities): sell your maps of *other* realms to the archive. It pays the map's full value if it beats their chart (×1.5 against a realm they're at war with), 30% if it doesn't. The Kingdom Details panel shows each realm's cartographer, maps drawn and charted realms.
- **Sell them a doctored map** and the archive may spot it (6% per atlas-skill point per alteration): you're turned away, lose 15 reputation and they trust you less (–25% on prices; after 3 frauds they won't deal with you). If it slips past, its lies sit in their war maps: –5% battle power per lie against that realm (max –20%) until their own cartographer redraws it — and then they know who sold it.
- A capital's archive sells **copies of its charts** of other realms, and the official map of the realm is only as accurate as its cartographers.
---

## 26. Legendary Artifacts

Six legendary artifacts are scattered across the world as fragments. Reforging one pays a one-time reward, and the relic then stays with you for good:

| Artifact | Fragments (found in) | Reforge reward | Lasting effect |
|----------|----------------------|----------------|----------------|
| 🗡️ Sword of the First King | 3 (ruins, monuments, caves) | 800g, 35 renown, +1 Combat | +15% battle power |
| 👑 Crown of Embers | 4 (monuments, ruins, shrines) | 1,000g, 40 renown, +1 Diplomacy | +25% reputation gains |
| 🧭 Astrolabe of Tides | 3 (caves, oases, ruins) | 700g, 30 renown, +1 Cartography | Ships sail 30% faster |
| 🏆 Chalice of Dawn | 3 (shrines, oases, monuments) | 600g, 30 renown | Heals 3 health a day; +0.2 karma a day |
| 🚩 Banner of the Iron Host | 4 (ruins, monuments) | 900g, 40 renown | −25% battle casualties, +10% morale |
| 📖 Ledger of the Coin-Kings | 3 (ruins, caves) | 1,200g, 25 renown | +15% property income, +5% trade prices |

Find all fragments by exploring POIs, then reforge the artifact at a city or large village (population 200+). Collecting a first fragment unlocks a quest to complete the relic.

---

## 27. Bounty Hunting

Track and capture wanted criminals across the map for gold and renown. Available through the **Notice Board** at settlements or via the **Jailer** title.

- **Notice Board** criminals (difficulty 3–10, roughly 175–700g) get harder as your record grows; **Jailer** fugitives are smaller jobs (20–60g).
- Choose to **turn in** captured targets for the bounty or **recruit** them to your cause.
- A failed arrest lets the quarry flee a few hexes, and each escape makes it warier (+1 difficulty, up to +3).

### Hunter Ranks

Every 3 criminals you bring in raise your rank. Each rank above the first adds +1 capture power and +10% bounty pay (up to +4 / +40%).

| Rank | Title |
|------|-------|
| 1 | 🔰 Novice Tracker |
| 2 | 🎯 Bounty Hunter |
| 3 | 🏹 Seasoned Hunter |
| 4 | 🐺 Manhunter |
| 5+ | ⭐ Legendary Hunter |

Achievements: **Dead or Alive** (bring in 5 criminals) and **Legendary Hunter** (reach rank 5).

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

### Your Festival Record

Your record as a host builds over time (shown in the festival menu):

- **Fame:** +1 renown per 3 festivals hosted (up to +5), and one more rival envoy attends per 5 hosted (up to +2 more).
- **Contest veteran:** each podium finish adds +0.3 to future contest performance (up to +3).
- **Vigilance:** each past sabotage attempt cuts the chance of the next by 1% (up to −10%).
- **Novelty:** a town that has hosted one of your last 3 festivals is less impressed: −30% renown for each.
- Achievements: **Master of Revels** (host 10 festivals) and **Champion of the Lists** (5 podium finishes).

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

---

## Travel Companions & Notoriety

**Travel party.** Friends who join your travel party pull their weight according to their trade:

| Companion | Benefit |
|-----------|---------|
| General / Knight / Guard / Hunter | +12% / +10% / +6% / +5% battle power |
| Merchant / Artisan / Weaver / Miller / Baker | +5% / +3% / +3% / +2% / +2% trade prices |
| Diplomat / Noble / Scholar | +1.5 / +1 / +0.5 effective diplomacy |
| Healer / Herbalist / Priest | heal you 5 / 3 / 2 health a day |
| Anyone else | keeps camp (heals 1 a day) |

Each day on the road together also raises your relationship with every companion by 1.

### Companions With a Life of Their Own

Companions are more than their trade. Each one holds **one or two values** and keeps an **approval** score (0–100) of you. Values are picked when they first join, from their trade and a fixed draw on who they are. A companion keeps the same values for good, and companions from older saves get theirs when the save loads.

| Value | Approves of | Disapproves of |
|-------|-------------|----------------|
| 🛡️ Honour | honesty, valour, just rulings, kept alliances; becoming Honest or Brave | lies, cowardice, piracy, kinslaying; becoming Craven or Deceitful |
| 🙏 Piety | piety, holy sites, miracles, pious rulings | cruelty, drink and dice, piracy |
| 💰 Greed | profit, plunder, treasure, gambling, being paid on time | generosity, generous rulings |
| 🕊️ Compassion | mercy, generosity, merciful and generous rulings, good karma | cruelty, dread, piracy, conquest, severe rulings |
| 👑 Ambition | valour, tournaments, conquest, alliances, victories | cowardice and defeats |
| 🕊 Freedom | travel, the sea, ruins | dread, zeal, crushing heresies, conquest, severe rulings |
| 🏰 Loyal to their homeland | your standing with their home realm rising | your standing there falling, deceit |
| ⛪ Loyal to the faith | zeal, piety, crushing heresies, holy sites | deceit |

Approval reacts each day to what you did: the deeds behind your character traits, any trait you earn, your rulings at Court, piracy, big karma swings (2 or more in a day), battles won or lost, and wages. When something moves a companion by 3 or more in a day, they **say so** in a short notification. One day can move them by at most 12.

**Mood.** Approval sets a mood, and the mood scales the companion's trade bonus:

| Mood | Approval | Bonus |
|------|----------|-------|
| 😠 Mutinous | under 25 | ×0.6 |
| 😒 Disgruntled | 25–39 | ×0.8 |
| 🙂 Content | 40–74 | ×1.0 |
| 😊 Loyal | 75+ | ×1.25 |
| 💛 Devoted | personal quest fulfilled | ×1.5 + a unique perk |

**Wages.** Every companion draws a daily wage (2–6 gold by trade, more for the greedy and ambitious), paid every 7 days. If you can't pay, they lose 8 approval on the first missed payday, 16 on the second and 24 on each one after that. They complain until you clear what you owe from the roster.

**When approval falls.** Below 40, a companion grumbles every few days about their latest grievance. Greedy or ambitious companions below 30 **demand a raise** (50% more). Grant it for +12 approval, or ignore it and lose 8 approval every 10 days. Below 20, a companion may **desert**. A greedy or ambitious companion below 12 is worse. First you get a **warning** that they are acting strangely. If you can't win them back within 3 days, they may **betray** you. They either run off with up to a fifth of your purse (at most 400 gold), or sell your position. Sold to a rival House, the betrayal raises that House's feud by 20, and the House starts a scheme against you if it can. Sold to the realm that likes you least, it costs you 10 reputation there. Betrayals go in the House chronicle.

**Personal quests.** A companion at 70+ approval who has travelled with you for 7 days shares a personal matter. You can **Hear them out** from the roster, and the matter becomes an ordinary quest in your journal (it counts toward the 5-quest limit). There are 11 kinds, picked to fit the companion's trade and values:

| Quest | What it takes | Perk when fulfilled |
|-------|---------------|---------------------|
| Blood Owed (avenge their kin) | win 3 battles | ⚔️ Sworn Blade: +8% battle power |
| The Lost Sibling | visit 2 taverns and 3 new settlements | 🧭 Pathfinder: +3% battle power, +1 heal |
| A Debt Come Due | pay 300 gold toward it from the roster | 📒 Ledger-Keeper: +3% trade, +0.5 diplomacy |
| The Long Pilgrimage | visit 2 holy sites | ✨ Pilgrim's Grace: +2 heal, +0.5 diplomacy |
| The family heirloom | explore 2 ruins | 🛡️ Shield-Sibling: +6% battle power |
| The Beast of the Hills | slay a great beast | 🛡️ Shield-Sibling |
| Restore the Family House | earn 600 trade profit | 📦 Quartermaster: +4% trade |
| Taken at Sea | defeat pirates at sea | ⚓ Sea Legs: +4% battle power, +2% trade |
| The Stolen Manuscript | hire an informant, explore a ruin | 📜 Lorekeeper: +1.5 diplomacy |
| A Name Cleared | drive off raiders twice | 🗣️ Silver Tongue: +1 diplomacy |
| The Healer's Oath | give 150 gold of charity through them | 🩹 Field Surgeon: +3 heal |

Fulfil the quest and the companion becomes **Devoted**. Their approval goes to 100 and they stay Devoted whatever you do after that. They never complain or leave, and their perk lasts. The House chronicle remembers it. If a companion leaves or dies, their quest is dropped.

**Bonds.** Companions who travel together for 20 days become **friends** or **rivals**. Shared values make friends and clashing values make rivals, such as greed against compassion or freedom against loyalty. Each friend in the party makes a companion 5% more effective, and each rival makes them 5% less.

**The fallen.** Companions fight beside you. In every battle each one has a small chance to fall: 1% in a victory and 3% in a defeat, half again more for fighters. The party mourns them, their friends lose approval, and the House chronicle records it. The roster keeps a list of the fallen.

**The roster.** *Travel Party* (top bar or the armies rail) shows each companion's mood, approval, values, bonds, wage, current gripe and quest progress. From there you can **Talk** (once a day, +2 approval, and they tell you what they care about), give a **Gift** (40 gold, +6 approval or +9 for the greedy, once every 3 days), **Pay** wages early, **Grant** a raise, hear out or pay toward a personal quest, or **Dismiss** them.

**Rumours of your crimes.** When gossip about a crime reaches a settlement, its guards may turn hostile and its crown may post a bounty on you. If the rumour is bad enough, the settlement **bans** you. The worst crimes bring a **warrant** that covers the whole kingdom. While you're banned or wanted, merchants, taverns, recruiters and officials turn you away. Only the guard tower will still deal with you, so you can settle your record there. Bounties and warrants lapse after 90 days if you don't pay them.

**Settlement food.** Most townsfolk grow their own food, so only the gap matters: villages run a small surplus and grow slowly towards a size cap (village 1,500 · town 5,000 · city 15,000 · capital 30,000); towns and cities buy their shortfall with their own gold. A settlement that is both short of food and broke starves and shrinks, gradually.

**Diplomacy Mastery** also makes gifts to lords buy more goodwill and softens a former crown's anger when you pledge to another. **Explorer** rulers scout further afield and survey more sites when founding colonies.

