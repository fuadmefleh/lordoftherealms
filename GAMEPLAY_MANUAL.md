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
    - [Merchant Houses: the Trading Company](#merchant-houses-the-trading-company) — charters, factors and standing orders, supply contracts, rival houses, monopolies, shares and royal ventures
8. [Housing](#8-housing)
9. [Military & Combat](#9-military--combat)
10. [Mercenary Contracts](#10-mercenary-contracts)
11. [Religion & Faith](#11-religion--faith)
12. [Technology & Research](#12-technology--research)
13. [Infrastructure](#13-infrastructure)
14. [Espionage](#14-espionage)
    - [The Underworld](#the-underworld) — heat, the thieves' guild, contraband, fences
15. [Ships & Naval](#15-ships--naval)
16. [Kingdoms & Diplomacy](#16-kingdoms--diplomacy)
17. [Titles & Royal Office](#17-titles--royal-office)
    - [Claims & Crowns: the Path to the Throne](#claims--crowns-the-path-to-the-throne)
18. [Relationships & Dynasty](#18-relationships--dynasty)
19. [Culture](#19-culture)
20. [Colonization](#20-colonization)
    - [Developing Your Holdings](#developing-your-holdings) — projects, governors, garrisons, unrest and rebellion
    - [Patronage & Great Works](#patronage--great-works) — clients, commissions, the gallery, cathedrals, libraries and wonders, the race with the kingdoms
21. [Tavern & Intelligence](#21-tavern--intelligence)
22. [Quests](#22-quests)
23. [Achievements](#23-achievements)
24. [World Events](#24-world-events)
    - [Sagas](#sagas) — month-long world storylines: the wyrm, the plague cult, the lost heir, the long winter, sea reavers, schism, a rogue company, the comet
    - [Outlaw Lairs](#outlaw-lairs) — bandit camps, smugglers' dens, deserters' forts, cultist grottos and beast dens that grow, raid, and must be dealt with
25. [Cartography](#25-cartography)
26. [Legendary Artifacts](#26-legendary-artifacts)
27. [Bounty Hunting](#27-bounty-hunting)
28. [Festivals & Tournaments](#28-festivals--tournaments)
    - [Rival Adventurers](#rival-adventurers) — named rivals who delve, hunt bounties and compete with you; the Hall of Heroes
29. [Saving & Loading](#29-saving--loading)
30. [Controls & UI](#30-controls--ui)
    - [The Steward's Counsel](#the-stewards-counsel): the advisor that ranks today's threats, opportunities and goals, with a morning brief
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

### Wounds, Sickness & Medicine

Besides your health points, you can carry **conditions**: wounds and diseases. Each one shows as an icon in the bottom bar next to your mood. Hover it to see its effects and how long it has left. The **Character panel** lists them under *Condition*, with buttons to use remedies from your pack.

**Wounds.** Fights can leave wounds that last after the health loss heals:

| Wound | Effects while it lasts | Heals in | Infection risk | Can leave |
|---|---|---|---|---|
| 🩸 Deep Gash | −3% battle power | 5–9 days | some | — |
| 🦴 Cracked Ribs | −1 strength, −1 movement, −5% battle power | 12–18 days | none | — |
| 🦴 Broken Arm | −2 strength, −1 combat skill, −12% battle power | 20–30 days | slight | — |
| 🤕 Head Wound | −1 intelligence, −1 movement | 8–14 days | some | a scar (30%) |
| 🏹 Arrow in the Leg | −3 movement, −1 stealth, −5% battle power | 10–18 days | high | a limp (25%) |
| 🗡️ Slashed Face | −1 charisma | 6–10 days | some | a scar (50%) |
| 🐺 Savage Bite | −1 movement, −4% battle power | 6–12 days | very high | a scar (10%) |
| 💫 Concussion / 🌑 Dark Dreams | −1 intelligence / −1 faith | 6–12 days | none | — |

Where wounds come from: being robbed or ambushed with no army (25%), a beast (35%) or a monster (60%) falling on you, battles you fight in (6% when you win, 22% when you lose, and sea fights 18%), lost tournament bouts (15% each), hunting mishaps, a kick from a horse you are taming, hard blows in a brawl on the local map, and delve failures. Carried leather armour (−20%) and a shield (−15%) lower the odds, and Divine Protection prevents wounds entirely. A second wound of the same kind extends the first instead of stacking.

**Healing.** A wound heals 1 day's worth each night, +1 in an inn bed or your own house (+½ at a deliberate camp), +½ once treated, +½ with a healer or herbalist in your party, and +1 near a Hospital you own. An **untreated** wound can turn **infected**. An infected wound stops healing, drains 2 health a day, and may fester into **Wound Fever**. Treatment and dressing it with herbs or a salve make infection much less likely. An infection may clear on its own, and it clears fastest when you rest indoors.

**Lasting marks.** A head wound, slashed face or bite can heal into a scar, which gives you the **🩹 Scarred** trait: intimidation is 1 easier, townsfolk warm 15% slower, +3 military faction, and brave or cruel lords respect it. An arrow in the leg can leave a limp, which gives you the **🦵 Lame** trait: −1 movement every day, intimidation 1 harder, and townsfolk warm 5% slower. Treated wounds scar half as often. These marks are permanent, but your heir does not inherit them.

**Sickness.** A disease runs through stages. At the end of each stage it either passes or gets worse. The last stage of a serious disease can kill, but only once it has worn you down: while you are above 40% health, a deadly crisis instead costs a fifth of your health. Get treated before the next one.

| Disease | Caught from | Stages | Contagious |
|---|---|---|---|
| 🤧 Chill | A night in the open in a storm, snow or blizzard (more likely the more health it costs you) | Chill → Fever → Lung Fever (deadly) | slightly |
| 🥵 Heatstroke | A night in the open in a heat wave | one short stage | no |
| 🤢 Bloody Flux | Eating raw rations (fish, grain) as your daily food | Gripes → Bloody Flux (deadly) | yes |
| 🦟 Marsh Fever | Nights in swamps and tropical jungle, worst in summer. A settlement, inn or house helps a lot. | Shivers → Marsh Fever (deadly) | no |
| 🐀 Plague | Standing where a Plague Outbreak rages. Crowded cities and capitals are the worst, and the wild is the least risky. Plague resistance techs cut the chance. | Buboes → Black Death (very deadly) | highly |
| 🦠 Famine Fever | The lean season, much worse when you are hungry or starving, and in crowded towns | Hunger Fever → Famine Fever (deadly) | yes |
| 🦷 Scurvy | More than 28 days aboard ship without fresh food. Carrying fruit or berries prevents it (you eat one every 3 days at sea). | Sea Weariness → Scurvy (deadly). It recovers much faster ashore with fresh food or in a town: each day ashore counts as three, and it is far less likely to worsen. | no |
| 🔥 Wound Fever | An infected wound festering | Fester → Wound Fever (deadly) | no |

A strong constitution (strength above 5) lowers the chance to catch anything.

**Care.** How well you are looked after lowers both the chance that a disease gets worse and the chance that it kills you. Each of these helps: an inn bed (×0.5) or your own bed (×0.55), a camp (×0.85), a healer (×0.7), herbalist (×0.8) or priest (×0.9) in your party, a temple blessing, a Hospital you own nearby, your own Herbalism research, a physician's treatment, and remedies.

**Contagion.** A contagious disease can spread to your travel companions, and a sick companion can give it back to you. Sick companions can die of it, so have them nursed by a physician. Aboard your ship, a contagious disease can spread to the crew. A long voyage without fresh food can also bring scurvy to the crew. A sick crew loses 2 morale a day and now and then a sailor, and the outbreak passes twice as fast in port.

**Medicine.**
- **Physician / herbalist** (world-map action **See a Physician**, shown when you or a companion need one, or the *Infirmary* at a church or temple altar). Treatment is free of AP and costs about 18 gold per point of severity: wounds 1–3, plus the disease stage, plus 1 if infected. The price is scaled by settlement size (village ×0.85 … capital ×1.3). The quality of care is 45% from a village herbalist, 60% in a town, 75% in a city and 85% in a capital, plus 5% for Herbalism, +12% for wounds with Surgery, +8% for diseases with Plague Prevention and 10% for Hospital (up to 95%). A treated wound is cleaned (any infection cut out), set to heal sooner, heals faster, rarely festers and scars half as often. A treated disease is less likely to get worse or kill, and it may ease a stage at once. Treatment also restores 10 health. A physician can also nurse a sick companion.
- **Temple healing rites** (in the temple's Blessing menu). These treat diseases only, at 60% of the price, and their quality depends on your faith (30% + 3% per point). They also give +1 karma.
- **Remedies from your pack** (Character panel): **Herbs** and **Rare Herbs** dress a wound against infection and ease a fever. A **Healing Salve** dresses a wound, speeds its healing and may draw out an infection. A **Healing Potion** eases a fever and may lift a stage. An **Elixir** eases a fever. **Holy Water** dresses a wound and may lift a disease stage (better with high faith). Each also restores some health.
- **Prayer** (once a day while sick) eases your worst disease for two days. The faithful are sometimes answered, and the disease lifts a stage. High faith and 20+ karma make this more likely.
- The **Divine Healing** miracle closes every wound and ends every sickness, as well as restoring your health.

**How often.** Ailments are occasional. A careful player who sleeps under a roof, eats cooked food, keeps out of plague regions and pays for treatment rarely falls ill, and almost never dies of it. Someone who sleeps rough in all weathers, lives on raw fish and never sees a physician will be ill a good part of the year.

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
| 🩹 Scarred | A wound that healed into a scar (see [Wounds, Sickness & Medicine](#wounds-sickness--medicine)) | Intimidate 1 easier, −15% goodwill, +3 military faction; permanent |
| 🦵 Lame | An arrow wound that left a limp | −1 movement a day, intimidate 1 harder, −5% goodwill; permanent |

- **Opposites** (Brave/Craven, Cruel/Merciful, Greedy/Generous, Honest/Deceitful, Beloved/Dread Lord) cannot coexist: earning one replaces the other.
- **Erosion.** Deeds against a trait wear it down (lies erode Honest, greed erodes Generous, mercy and festivals erode Dread Lord, and so on). A trait is lost once its progress falls below half its threshold. Progress caps at twice the threshold, so a deeply held trait takes a long run of contrary deeds to undo.
- **Who notices.** "Goodwill" scales how fast inner-map townsfolk warm to you. Lords add your traits to their opinion of you, and their own traits matter: a Pious lord likes a Pious player, a Cruel lord respects a Dread Lord, and an Honourable lord despises a Deceitful one. Traits also shift the council factions, the reputation you earn with kingdoms, and negotiation chances. Townsfolk sometimes greet you by your reputation.

### Death & Succession

Your character has a natural lifespan of 55–85 years (randomized). After your maximum age, there is a 15% chance of death per year that increases over time. If you die with a child aged 16+, you choose which of them to continue as. The death screen shows each heir's profile: stats, skills, education and traits. The heir inherits 75% of your gold, 50% of your renown, and 30% of your reputation, and starts with the stats, skills and traits their upbringing gave them (see [Children & Heirs](#children--heirs)). With only younger children you may install a regency. Without any heir, the line ends and the **epitaph** screen scores your House's legacy (see [The House Chronicle and Legacy](#the-house-chronicle-and-legacy)).

The late ruler's own traits are **not** inherited. Instead your House keeps a *reputation of the dynasty*: the late ruler's two strongest traits at half strength. This echo only affects how others react to you (goodwill, lords, intimidation, reputation, council factions), and it fades by about a quarter of a percent a day until it is gone.

You can also die in combat (health reduced to 0), from starvation, or from sickness and festering wounds (see [Wounds, Sickness & Medicine](#wounds-sickness--medicine)). The late ruler's wounds and diseases die with them: an heir starts hale.

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
- **Exposure:** ending the day in the open in a storm, blizzard or heat wave costs health and comfort. A settlement, an inn or your own house protects you completely; a deliberate camp halves the loss. Exposure can also give you a **chill** (storms, snow) or **heatstroke** (heat waves).
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

Choices spend **stamina** (today's movement; if you run out you pay 3 health per missing point) and sometimes gold or an item (meat to distract a beast, lamp oil to burn a path). Failure brings harm, which armour and treasures reduce, and may bring a lingering **injury**: a broken arm (−2 strength, −1 combat), concussion (−1 intelligence), a slashed face (−1 charisma, may scar) or dark dreams (−1 faith). Each lasts about 6–12 days. Injuries are ordinary wounds: they heal faster with rest and treatment, and some can turn infected (see [Wounds, Sickness & Medicine](#wounds-sickness--medicine)). A delve never kills you, but if your health falls to 10 or below you collapse and stagger out with what you carry.

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

**Foraging and hunting** pay in goods, not coin: what you find goes into your packs (packs permitting; finds that don't fit are left behind), to eat or sell. Every wild find is a market good: truffles, crabs, a bear pelt and the rest sell at about the price the search screen shows. Each loot entry comes in its usual bundle (berries 2–5, herbs 1–3, a truffle 1), on the quick path too.

- **Forage** (quick): one find in its bundle. **Search the patches** (minigame): a 4×4 field. You get 4 searches + Intelligence ÷ 3, and numbers show how many finds lie next door.
- **Hunt** (quick): one quarry in its usual yield. **Track → Stalk → Strike** (minigame): a clean shot yields each kind of game the land offers, in its qty range (at least one).
- **Intelligence** widens a forager's search: more finds and a better chance of an extra one in each bundle. **Combat** and **Strength** steady a hunter's aim and raise the yield.
- **Luck** favours the rare finds (anything 10% or rarer: truffles, pearls, fossils, a bear pelt, ivory) by +8% for each point above 5, and gives a 4% chance per point above 5 of one more in each bundle.
- **Craft rank.** Every outing counts, and so does every hunt, hit or miss, and every trap line. Foraging: 🌱 Novice → 🌿 Gatherer (5 trips) → 🍄 Woodwise (15) → 🌺 Herb-wise (35) → 🏵️ Master Forager (60). Hunting: Novice → 🐾 Tracker → 🏹 Huntsman → 🦌 Stalker → 🐗 Master of the Hunt, at the same counts. Each rank adds +8% to the odds of a find or a drop and a 10% chance of one more in each bundle. Woodwise and Master Foragers get an extra search, and each hunting rank lowers the accuracy a shot needs by 2. Your rank shows on the search screen and in **Deeds & Records**.
- A forager who finds 3 or more things in one outing gains +1 renown.

---

## 4. Economy & Trade

### Trading at Settlements

Every settlement has a market where you can buy and sell goods. Each market keeps a **real store** of goods (see [Town Markets: Stock, Scarcity and Trade](#town-markets-stock-scarcity-and-trade)), and its prices follow that store. Prices vary by settlement type:

| Settlement Type | Buy Price Modifier | Sell Price |
|----------------|-------------------|-----------|
| Village | 1.2× what the good is worth there | 70% of what it's worth there |
| Town | 1.0× | 70% |
| City | 0.9× | 70% |
| Capital | 0.8× | 70% |

What a good is worth in a town is its base price × the town's **scarcity** of it × the season × cold-weather demand × world events (and a realm's debased coin). Food is cheap after the harvest and dear in the lean months, furs dear in winter (see [Seasons & the Agricultural Year](#seasons--the-agricultural-year)). Local resources still cut the asking price (grain on wheat land, metalwork on coal, …), and a monopoly's markup raises it. Each trade earns +0.1 Commerce skill.

**Buying and selling move the stock.** Buying takes goods off the stalls, so each unit costs a little more than the last, and you can't buy more than the town holds. Selling puts them in store, so each unit fetches a little less. The trade window shows each good's stock label (Glut, Plenty, Steady, Scarce, Dearth), how far its price stands from base, which way it is moving (▲/▼) and how many days of the town's needs are in store. Its header notes the town's worst shortage, any glut, the day's trader traffic and disrupted roads. Nothing bought on a tile sells straight back there at a profit: a sale never pays more than buying the same units back would cost, here or in a settlement next door.

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

### Town Markets: Stock, Scarcity and Trade

Every settlement keeps one store of goods: about thirty staples from grain, bread and beer to firewood, cloth, tools, iron, horses and luxuries (`data/markets.json`). That store is what you buy from and sell into. Caravans, ports, trading-company factors and tavern talk all read the same store.

**Market day.** Each market takes its turn **every 4 days**. Markets are staggered by place, so a few towns hold market every day, and each one works four days at once. On its day a town:

- **Produces.** Food comes from the land around it. Farmland grows grain (fertility by terrain, a river helps), the waters give fish, and pastures give meat. Villages grow about twice what they eat, towns a little more than their own needs, and cities and capitals about their own. The food follows the agricultural year (much of the harvest comes in autumn), so grain is cheap after the harvest and dear before the next. Droughts and blights cut it. Forests give wood and firewood, hills give stone, and pastures give wool, hides and horses. Map resources add their goods: iron, coal, gems, gold ore, spices, rock oil, salt, timber, hides and horses. Craftsmen add a share of cloth, clothes, tools and weapons. A player property within 3 hexes adds a quarter of its output. A holding's Workshop Quarter raises the town's goods, and storm or quake damage lowers them.
- **Works up goods.** Wherever the output runs short, its trades turn goods into others:
  - Every settlement mills grain into flour, bakes it into bread, brews beer and burns charcoal.
  - Every settlement also tans hides into leather.
  - Towns and larger also weave, tailor, distil and make cheese. Their smiths turn iron and coal into tools and weapons, or iron and firewood into tools.
  - Cities and capitals also have jewellers, who turn gems into luxuries.
- **Consumes.** Its people eat, drink, burn and wear out goods every day, more of them in bigger towns. Cities and capitals also want wine, luxuries, spices, gems and quality horses. In cold weather they burn 3× the firewood and wear out more clothes. A town holds at most twice its target of firewood, so a cold winter far from the forests is felt. Food and fuel can stand in for each other: with no bread they eat porridge, with no firewood they burn coal. When a good runs short, people buy at most half of what's left, so a dear good stays on sale.
- **Spoils.** Bread, fish and meat go off within days, grain keeps for months, and iron never spoils. Each store can only hold so much.

**Scarcity sets the price.** A good's scarcity is (stock ÷ (daily need × target days)) ^ −0.45. It is clamped between 0.6× (a glut) and 2.2× (a dearth). A good the town doesn't use is never dearer than its base. A town newly founded, or one from an older save, starts with its stores full and its prices at base.

**NPC trade.** Merchants move goods along the kingdoms' **trade routes** and between near neighbours: up to 4 partners each, by land within the same region (up to 7 hexes) or port to port by sea (up to 14). A good travels from the town where it's cheap to the one where it's dear, as long as the price gap beats the haul. The haul costs 3.5% a hex, 40% less along a road and half by sea. Each link carries a few hundred gold of goods each market day. More routes and bigger towns carry more. Prices even out along busy roads. Each town keeps half of the value gap of what moved as **trade income**, which is what kingdom trade routes earn now (there is no flat payment per route). Goods that travel as a caravan or trading ship (below) earn their towns this income only **when they arrive**: a robbed cargo earns neither town anything, and a seized one earns the seizing realm's market. Peoples' commerce and gems, spices and the like nearby still raise it.

**Disruption.**

| Cause | Effect on trade along the link |
|---|---|
| War between the two realms | Closed |
| Either realm at war with anyone | Down a quarter |
| An enemy blockade of either port (sea legs) | Halved, or closed if the blockade is tight |
| A siege of either town (yours, or of your holding) | Closed |
| An outlaw lair within 3 hexes of the road | Thinned by up to 60%, depending on its strength |
| A raider band within 2 hexes of the road | Down 35% |
| World events on trade income | Raise or lower it |

A road where a caravan was lost is shunned for 12 days and carries half its trade. A link whose goods travel as a caravan that turn is not thinned for lairs and raiders. The caravan meets them on the road instead (see below).

A raid that reaches a town burns half the share of its stores that it burns of the granary. Sacking a town carries off 80% of its stores, and conquering it carries off half. A town cut off from its suppliers runs short.

**Shortages matter.**

| Shortage | Effect |
|---|---|
| **Food** | Once a town goes without about a quarter of its food for weeks, it is in **dearth**. Its people eat harder into the granary (more consumption in the food model, so less growth and more hunger), and the crown sees it as hunger. Your famine dole ships it grain even outside the lean weeks, and the dole's grain reaches the market too. Tavern talk and townsfolk mention it. |
| **Tools** | Up to a quarter of the town's goods and gold output is lost, and its trades slow down. |
| **Fuel in cold weather** | Up to 6 happiness points are lost. |
| **Plenty of beer, wine and fine things** | When every want is met and the stores run well past target, happiness rises by up to 2.5 points. Brewers brew ahead of need while grain is in glut, so beer runs past its target after the harvest: the mood lifts in about a quarter of town-days, mostly in autumn and winter. |

Market mood moves half a point a day and is given back when the cause passes.

**News of the market.** Merchants in the tavern pass on real dearths along the roads: "a carter says Brindle has run short of grain — it fetches around 14g there". Their price reports and trade tips quote the real prices of the goods markets trade. Townsfolk grumble about a dearth ("Bring grain to Tallow and name your price") and point out a glut ("Wool is cheap as dirt here").

#### Merchant Caravans and Trading Ships

Some of that NPC trade travels the map as real units: 🐫 **caravans** on land, preferring roads, and ⛵ **trading ships** on sea links (`data/merchantCaravans.json`). On each market day up to 2 of the busiest links that are trading send their goods this way. The goods leave the exporting town as usual, but they reach the importing town **only when the trader arrives**. Everything else still moves in bulk, as described above.

There are never more traders on the map than a quarter of the towns (at least 4, at most 24), and never two on the same link. A lot worth less than 50 gold at base price lands at once.

Each trader belongs to a merchant house (one that deals in its main good). It has guards (4, plus more for a richer cargo) and a purse, and moves 3 hexes a day, or 4 along a road the whole way. A ship moves 6. The hex info shows its house, cargo, route and tolls.

**Dangers on the road.**

| Threat | What happens |
|---|---|
| A raider band (or a pirate, for ships) within a hex | It attacks. Lairs' raiding parties are bands too. The trader is taken with odds of attackers ÷ (attackers + guards + nearby wardens). |
| An outlaw lair within 2 hexes | Each lair tries each passing caravan once. The chance is up to 30%, depending on the lair's strength, and half that with wardens nearby. |
| Land of a realm at war with either of the trader's realms | 35% a day that it is seized. The cargo is sold in that realm's nearest market and the purse goes to its treasury. |

A taken cargo goes to the band's packs (a lair banks it in its hoard). It never reaches the town waiting for it, so a dearth follows downstream. Merchants then shun the road for 12 days. A loss worth 150 gold or more is cried by the **heralds** ("the salt caravan bound for Tallow was taken by the Red Hand").

**Tolls.** A trader crossing into another realm's land pays 3% of its cargo's value from its purse into that realm's treasury.

**Road wardens.** Every 15 days a realm with 2,500 gold or more in its treasury, or with a lawful lord, may send 💂 **Road Wardens** to ride up and down its busiest road for 30 days. The road it picks has the most caravans and kingdom trade routes, and preferably a road the whole way. The wardens cost 80 gold from the treasury. They ride down raider bands within 2 hexes, break any they can match (at most 4 companies of wardens ride at once), and fight alongside a caravan within 2 hexes.

**Meeting a trader.** Stand on or next to a trader and choose **Hail**:

- **Trade.** Buy from its cargo, or sell it the goods it carries. The price runs from the good's value at the origin toward its value at the destination as the journey goes, plus 10% when you buy and minus 12% when you sell. What you buy never reaches that market. The merchant will not touch stolen goods.
- **Escort.** Hire on for about 7% of the cargo's value (15–300 gold), paid on arrival. Stay within 6 hexes, or after 2 days the merchant hires other blades. Ride within 2 hexes and any ambush becomes your fight (your army against the attackers, the usual battle). Win and the caravan rides on. Arrival also brings renown and +3 standing with the destination's realm. You can guard one trader at a time, and a ship only from your own deck. The Steward's **Counsel** mentions an escort job within 4 hexes.
- **Rob.** This is an attack on the trader. Win and its goods are **hot** (only a fence takes them). You also suffer a `caravan_robbery` crime (10 heat with its realm, 22 if wardens or a town saw it, which also reports the crime and can bring a bounty) and lose 15 reputation with the realm. The road is shunned and the destination goes without. A failed robbery still costs half the heat and reputation.

### Merchant Prince: Industry, Warehouses and Contracts

Beyond buying and selling, a rich trader can work a town's market from the inside. Open a town's **Trade** window and use its **🏭 Invest**, **📦 Warehouse** and **📜 Contracts** tabs (the **📒 Holdings** tab lists everything you own, anywhere). The Steward's Counsel warns of contracts falling due, rent owed, stock spoiling and works at risk. Tuned in `data/merchantPrince.json`.

**Industry.** Fund works in a town: a grain mill, bakehouse, brewhouse, charcoal kilns, distillery, weaving shed, tailors' hall, creamery, tannery, smithy, armoury or jewellers' row. Each one is one of the town's own trades (the recipes above), and needs a big enough town. Each level costs gold plus building materials from your packs, adds a few runs a day, and costs 35% more than the last. A works can grow to 3 levels (the jewellers to 2).

- **How it runs.** On market day the works run after the town's own trades, on the town's real stock:
  - They take their inputs only while the town keeps at least half its target of them.
  - They stop while their goods glut the stalls (twice the target).
  - They stop when a run no longer adds value at today's prices.
- **What it pays.** You get **40%** of the value the works added (the output's worth less the inputs', at the town's prices). The crown takes a **tithe** of that: 10%, +15% while the realm is at war, and +20% while its treasury is in crisis. If you rule a realm whose court enforces *Merchant charters*, foreign crowns take only half.
- **Your own towns.** In a town you hold, works cost 15% less, pay you **60%**, and owe no tithe. There is no tithe anywhere in a realm you rule.
- **Choosing a town.** The tab shows each trade's inputs and outputs with their stock labels, what a run adds at today's prices, and how much the town's own trade already works. A bakehouse in a great town with grain to spare repays itself in about 45 days. In a small town, or one short of grain, it may barely turn. Weaving sheds and smithies are starved of wool and iron unless you bring them in: sell the inputs into the town and the works will use them.
- **Losing it.**
  - A realm at war with you, or with the realm you are sworn to, seizes your works at once.
  - A crown whose treasury is in crisis may seize them at its weekly reckoning.
  - If your reputation in the realm stays below −30 for 10 days, the town's guilds expropriate them. The Counsel warns you below −20.
  - Seized works keep running for their new owner.
- **Damage.**
  - A raid or sack that loots the town's stores also damages the works. So does a bandit raid that gets into one of your holdings.
  - A siege of the town idles them and wears them 3% a day.
  - Storm and quake damage to the town slows them.
  - Repairs cost half the works' price times the damage.
  - You can sell your stake back to the guild for 40% of what you put in, times its repair.

**Warehouses.** Rent a **store-room** (150 units, 40g key, 6g a week) or a **warehouse** (500 units, 120g key, 16g a week) in up to 5 towns. Its goods don't take slots in your packs.

- **Filling it.** Buy straight from the stalls into store (the price climbs as usual), or store goods from your packs.
- **Using it.** Take goods back into your packs, or sell them into *that* town's market at its price on the day. A sale never pays more than buying the same goods back would cost.
- **Speculation.** Fill it with grain in the harvest glut and sell in the lean weeks, or hold goods for a dearth.
- **Spoilage.** Goods keep twice as well as on a stall, but fish, meat and bread still spoil within weeks.
- **Rent.** Rent is due every 7 days. After two unpaid weeks, the landlord sells your stock off and lets the room to another.
- **Thieves.** They strike more often where the Thieves' Guild works, the more heat you carry in the realm, and with an outlaw lair or raiders nearby. A strong town watch and a guild rank of 2 or more protect you. A theft carries off 15–40% of the stock.

**Forward contracts.** A town will agree today to buy a good its people use, for delivery by a day 10–60 days away, at a price fixed now.

- **Price.** The price is what the lot fetches in the town today, plus a premium for the wait (3% + 0.2% a day, at most 15%). It is never more than buying the lot back here.
- **Size.** At most 15 days of the town's need.
- **Delivery.** Deliver in parts, from your packs or your store-room in the town. Each delivery is paid on the spot, and the goods join the town's stock.
- **Limits.** You can hold at most 3 contracts.
- **Missing the day.** A quarter of the undelivered value is forfeit, taken from your purse. You also lose reputation in the realm, and more of it if your purse can't cover the forfeit.
- **The bet.** If the town's price falls before the day, you deliver at the old, higher price. If it rises, you have sold too cheap.

### Market Fairs and Market News

Four fairs are held each year at the great towns:

| Fair | Day of the year | Where | Merchants bring |
|---|---|---|---|
| Spring Fair | 22, for 7 days | Capitals | Spices, luxuries, wine, clothes, tools, salt, horses |
| Midsummer Fair | 48, for 6 days | Capitals and cities | Wine, spices, cheese, cloth, beer, luxuries |
| Harvest Fair | 78, for 7 days | Capitals and cities | Grain, cheese, wool, hides, salt, horses |
| Frost Fair | 100, for 6 days | Capitals | Firewood, coal, clothes, liquor, lamp oil, salt |

Merchants from afar put their goods into the town's stores. The goods then sell, spoil and travel on like any other. While the fair is on, the stalls ask 6–8% less and pay **75–76%** of what goods are worth (not 70%). A sale still never beats buying the goods back. The heralds cry each fair, the tavern's merchants talk of fairs on or coming, and the Counsel points out one nearby.

Every week the heralds also cry the world's worst **food dearth** (a town in dearth with a staple at least 60% over its worth). In the weeks after the harvest they cry the deepest **grain glut** at a city or capital. A town is not cried again within 40 days.

### Price Knowledge: the Trade Map and the Merchant's Ledger

You do not see every market's prices from afar. You know a town's prices only from:

| Source | What you learn | How fresh |
|---|---|---|
| 👁️ Your visit | The whole market: asking price, what the stalls pay, stock | Each day you stand there |
| 🏪 Your trading company's factor | The whole market of each post's town | A report every 3 days |
| 🏰 Your steward | The whole market of each of your holdings | A report every 3 days |
| 🐫 A merchant met on the road | What its goods were worth at its origin and destination | As of the day it set out |
| 🍺 Tavern talk (bought, heard or from informants) | A few goods, as reported | As of the telling, and it may be wrong |

Every price you know keeps its age ("12 days old"). Talk only says what a good is worth, so the asking price is estimated from the town's size and the stalls' pay is 70% of it. Your book keeps up to 30 towns (the stalest are forgotten first). Tuned in `data/priceKnowledge.json`.

**The trade map.** Choose **📈 Trade Map** from the map modes (or press **M** until it comes up), then **G** to step through the goods (**Shift+G** back). Each town you know shows a marker with the good's last-known asking price, coloured by its stock (Glut blue to Dearth red), and the source and age of the news. Old news fades. Lines join the towns you know along the merchants' trade links: gold by land, blue by sea, thicker where caravans run often, and red and dashed where merchants shun a road after a loss. Caravans and trading ships in sight show the road ahead of them, bright if they carry the good.

**The Merchant's Ledger** (**📒 Ledger** in a town's trade window, or from the map-mode menu) has four pages:

- **📖 Price Book.** For each good, every known town's asking price, what its stalls pay, its stock, distance and the age and source of the news. **🗺️ Show on the trade map** opens the map on that good.
- **⚖️ Best Spreads.** The best known buy-here, sell-there margin for each good between two towns within 3, 5, 8 or 12 days' travel (about 3 hexes a day). It uses only what you know, so stale news can mislead, and a big lot moves the price against you.
- **📈 Price History.** The asking prices you saw in the 10 markets you visited last, a sample every 3 days.
- **💹 Profit & Loss.** Your trading at the stalls: each sale against the average cost of what you bought of that good (goods found, looted or made count as free), by good and by route (where you bought it → where you sold it).

### Map Resources and Settlements

Resources on or within 2 hexes of a settlement shape what it produces and how it works (a resource on the settlement's own hex counts in full, a nearby one at half; each effect is capped at +50%). Open a settlement's **Economic Breakdown** to see its "Resource Advantages".

| Bonus | From | Effect |
|-------|------|--------|
| Goods | iron, timber, stone, coal, cattle | More of every good the settlement makes |
| Military | iron, horses, coal | Cheaper recruits for you (half the bonus); the realm's armies regrow faster |
| Trade | gems, spices, salt, horses, oil | More trade income from the goods merchants move through the town; caravans you send there earn half the bonus; sales there a quarter |
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
| Leather | 18g | Hides (tanning: 1½ hides → 1 leather in a town's tanneries, 3 hides → 2 leather in your Tannery) |

### Banks, Credit & Coin

Money has its own life in the realms. A few great **banking houses** take deposits, lend to merchants and to crowns, and sometimes fail. Every realm strikes its own coin, and a crown in trouble may clip it.

**Banking houses.** Three to five named houses (the Medrano Counting House, House Varenne & Sons, …) keep their seats in capitals and great cities, at most one per realm, and the same world always has the same houses. A house serves you at its seat and at its **branches**, the cities and capitals of its realm. Look for the **🏦 bank** action there. Each house has capital reserves (your deposits are part of them, and its loans draw on them) and a standing with every crown. The Treasury's Bank tab lists the houses, their reserves and your accounts. The bank panel shows the full books: accounts, loans, royal bonds, your credit report and the realms' coin.

**Deposits** earn a slow, safe interest, compounded daily: about **4% a game year**, up to 7.5% at a house short of coin. They are not perfectly safe. If a house fails, its receivers pay back only **30–60%**. Deposits count as collateral, and the house you owe takes them first if you fall behind.

**Loans** come in four sizes:

| Loan | Amount | Base interest | Term | Credit needed |
|------|--------|---------------|------|---------------|
| Small | 500g | 10% | 30 days | any |
| Medium | 2,000g | 15% | 60 days | 520 |
| Large | 5,000g | 20% | 90 days | 600 |
| Great | 15,000g | 28% | 120 days | 680 |

The interest is a flat charge for the term, repaid in equal daily payments. Your **credit score** sets the actual rate: about a third less at 800 and a third more at 400. So do the house's reserves, since a house short of coin charges more. A bad name in the house's realm (reputation −20 or lower) adds 20%. The Merchant Guild tech cuts interest by 25%, and Banking Systems by another 20%. You may hold up to three loans from one house, within your **borrowing limit**: 60% of your collateral plus your gold, scaled by your score. You can repay a loan in full from anywhere.

**Your credit report** (300–850) is built from:
- **Repayment history:** loans repaid and days paid on time raise it. Missed payments, defaults (and recent ones in particular), and days overdue lower it. A debt made good wins some of it back.
- **Collateral:** properties at their build cost, ships, your trading company, holdings and deposits.
- **House Prestige.**
- **Debt load:** what you owe against what you own.

**Defaults have teeth.** A day you cannot pay adds a late fee and a day to the term. Then the arrears escalate:
- **7 days overdue:** the bailiffs take goods from your packs at half their worth, and your reputation in the house's realm falls.
- **14 days, then every week:** the house seizes collateral at half its worth, in this order: your deposits with it, your most valuable property, a ship lying in port (never the one you are aboard), then your company's coffers.
- **30 days:** you are **declared a defaulter**. The house writes off the rest and will not lend to you again until you **make good** the debt. You lose reputation in its realm (−15) and House Prestige. A debt of 1,500g or more puts a **bounty** on your head there. One of 4,000g or more sends you to the **debtors' prison** if the watch of any town in that realm catches you (5–20 days, with bail).

**Royal bonds.** Through any banking house you can lend to a crown, from 500g up to 20,000g per crown, for 120 or 240 days. You get interest every 7 days, the principal back at maturity, reputation with the realm (+1 per 500g, up to +10) and Prestige for your House (+1 per 400g, up to +25). A healthy crown pays about **6% a year**. A crown deep in debt, with debased coin or a recent default, pays up to 20%, because it may miss coupons, put off repayment by a month, or **repudiate** its debts and cut your bond with everyone else's. You can sell a bond back to the brokers at a discount.

**Crowns in debt.** Every crown keeps a reserve of about a month's income. War costs more than a realm earns, and a crown at war (or raising a wonder) that drops below its reserve borrows from the friendliest house with coin to spare. It pays interest from its taxes and pays its debts down every week. A crown in crisis (missed payments, unpaid armies, or debts beyond what its income can carry) chooses one of three ways out:
- **A war levy:** more gold for two months, and unrest (stability −6).
- **Debasing the coin:** gold from the mint at once. Prices in all of the realm's markets rise (+9% for each tenth of silver taken out), stability falls, the houses think less of it, and trust in its coin drops.
- **Default:** its lenders lose capital and may face a run, and the realm loses stability (−10 at once, −8 while the memory lasts). No house lends to it for months.

Honest coin returns slowly once a crown is out of trouble, or at once if new silver is found.

**Panics.** A run on a house is rare, but more likely when its vaults are low, after a crown defaults on it, or after a crown seizes its strongroom. During a run, withdrawals are rationed to a trickle a day and no loans are made. When the run ends, the house either stands, poorer, or **fails**. A new house opens at the seat about three months later. Heralds proclaim failed houses, crown defaults and debased coin, and townsfolk talk about clipped coin, levies and queues at the counting-house doors.

**As a ruler**, the bank panel's Coin tab shows your crown's purse. From there you can borrow for the crown, debase the coin, or repudiate the crown's debts.

The Steward's Counsel warns you of an overdue loan, of the next step it brings and when, of gold running short of your daily payments, of a run on a house that holds your deposits, of bonds with a crown in trouble, and of a debtors' prison waiting for you.

### Tax Collection

You can set tax rates if you govern settlements of your own, or hold the office of **King**, **Chancellor** or **Tax Collector**. Officials sworn to a kingdom need a council vote to *raise* taxes; an independent lord does not. Taxes are collected from your settlements every 7 days: **0.25 gold per inhabitant** × the rate, so a town of 2,000 at moderate taxes yields about 75g a week.

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
- **Development** changes all of this: markets, harbours and a good steward raise a holding's take, while a skimming governor or a revolt cuts it. Taverns, temples and squares raise its happiness target. See [Developing Your Holdings](#developing-your-holdings).

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
| Crown | Royal petitions come only to a reigning monarch, at the realm's capital (see [The Royal Court](#the-royal-court)) |
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
| Church / Temple altar | Infirmary (also **See a Physician** on the world map) | Treat wounds and sickness by severity; better in cities and with medicine techs (see [Wounds, Sickness & Medicine](#wounds-sickness--medicine)) |
| Temple | Healing Rites | Tend a disease for 60% of a physician's price, quality by your faith, +1 karma |

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
| 🌾 Farm | 700g | 5 days | Grain (6/day) | 6g/day | Plains, Grassland |
| 🐑 Pasture | 800g | 4 days | Wool (3/day) | 5g/day | Plains, Grassland, Hills |
| 🪓 Logging Camp | 700g | 3 days | Wood (4/day) | 6g/day | Forests |
| ⛏️ Mine | 1800g | 10 days | Iron (3/day) | 15g/day | Resource: Iron/Gold Ore/Gems/Stone |
| ⚓ Fishing Wharf | 800g | 8 days | Raw Fish | 10g/day | Coast, Beach |
| ⛰️ Quarry | 900g | 8 days | Stone (5/day) | 8g/day | Resource: Stone |
| 🧂 Salt Pans | 800g | 4 days | Salt (2/day) | 6g/day | Coast, Beach |
| 🐝 Apiary | 1000g | 3 days | Honey (2/day) | 6g/day | Plains, Grassland, Forest, Woodland, Hills |
| 🍎 Orchard | 700g | 5 days | Fresh Fruit (6/day) | 6g/day | Plains, Grassland, Hills, Woodland |
| 🌿 Hemp Farm | 600g | 4 days | Hemp Fiber (5/day) | 5g/day | Plains, Grassland |
| 🟫 Clay Pit | 450g | 3 days | Raw Clay (6/day) | 4g/day | In or next to a settlement |
| 🧀 Dairy | 800g | 4 days | Aged Cheese (2/day) | 6g/day | Plains, Grassland |
| 🏹 Hunting Lodge | 650g | 4 days | Hide (4/day) | 5g/day | Forests |
| 🐄 Cattle Ranch | 750g | 5 days | Meat (6/day) | 6g/day | Plains, Grassland, Savanna |
| 🌱 Herb Garden | 500g | 3 days | Herbs (5/day) | 4g/day | Forests, plains & hills |
| 🐎 Horse Ranch | 1100g | 10 days | Horses (1/day) | 12g/day | Plains, Grassland, Savanna |
| 🫐 Forager's Hut | 450g | 2 days | Berries (8/day) | 3g/day | Forests |

#### Processing buildings (recipe-based)

| Property | Cost | Build Time | Produces | Upkeep | Where |
|----------|------|-----------|----------|--------|-------|
| 🔨 Workshop | 800g | 7 days | Any recipe (3 output/day) | 10g/day | In or next to a settlement |
| 🍺 Brewery | 700g | 6 days | Beer / Liquor | 8g/day | In or next to a settlement |
| 🌬️ Mill | 600g | 6 days | Flour | 6g/day | Plains, Grassland, Hills, Woodland, Savanna |
| 🍞 Bakery | 700g | 7 days | Bread | 8g/day | In or next to a settlement |
| 🔥 Forge | 1000g | 9 days | Tools / Weapons | 12g/day | In or next to a settlement |
| 🦺 Tannery | 1100g | 6 days | Leather / Leather Armor / Parchment | 8g/day | In or next to a settlement |
| 🪚 Sawmill | 500g | 5 days | Firewood | 7g/day | Forests, plains & hills |
| 🍖 Smokehouse | 500g | 5 days | Smoked Fish / Dried Meat | 6g/day | In or next to a settlement |
| 🥩 Butcher | 400g | 3 days | Dried Meat | 5g/day | In or next to a settlement |
| 🪢 Rope Walk | 350g | 3 days | Rope | 5g/day | In or next to a settlement |
| 🏺 Pottery Kiln | 700g | 4 days | Pottery | 5g/day | In or next to a settlement |
| 🧵 Weaver | 900g | 5 days | Textiles / Clothes | 6g/day | In or next to a settlement |
| 🍷 Winery | 1200g | 7 days | Fine Wine / Mead | 8g/day | In or next to a settlement |
| ⚗️ Apothecary | 600g | 6 days | Healing Salve / Strange Potion | 8g/day | In or next to a settlement |
| 🏹 Fletcher | 700g | 4 days | Arrows / Bow | 6g/day | In or next to a settlement |
| 💍 Jeweler | 900g | 8 days | Amulet / Luxuries | 10g/day | In or next to a settlement |
| 🎨 Dye Works | 900g | 4 days | Dyes | 6g/day | In or next to a settlement |
| 🕯️ Chandlery | 350g | 3 days | Candles | 5g/day | In or next to a settlement |
| 🔮 Glassworks | 750g | 7 days | Glass / Lantern | 10g/day | In or next to a settlement |
| 📖 Scriptorium | 600g | 5 days | Parchment / Rare Book | 8g/day | In or next to a settlement |
| ⚔️ Blacksmith | 800g | 7 days | Shield / Tools / Weapons | 10g/day | In or next to a settlement |
| 🌸 Perfumery | 650g | 6 days | Perfume / Incense | 8g/day | In or next to a settlement |

#### Commerce

| Property | Cost | Build Time | Produces | Upkeep | Where |
|----------|------|-----------|----------|--------|-------|
| 🏪 Trading Post | 600g | 6 days | Attracts merchants | 5g/day | Settlement |
| 🍻 Tavern | 1200g | 8 days | Gold from patrons | 8g/day | Settlement |

A raw producer or a tavern repays its building in roughly **30–60 days** at first (a village tavern far slower), and faster as your Commerce skill, upgrades and techs raise its output (see `docs/economy-balance.md`). A **tavern** takes 14g a day in a village, 18g in a town or city and 22g in a capital, +2g per 250 inhabitants (up to +16), before your Commerce bonus, its level, and beer, liquor and gambling tables.

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
| 2 | 525g | +10% |
| 3 | 700g | +20% |
| 4 | 875g | +30% |
| 5 | 1050g | +40% |

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
- **Revenue**: what the destination market pays for the goods, × (1 + distance × 0.01) × settlement multiplier × (1 + Commerce × 0.05). The destination pays 70% of what each unit is worth there as the load lands in its stores, so a big load of something the town already has plenty of fetches less a unit (see [Town Markets](#town-markets-stock-scarcity-and-trade)). The goods then join the town's stock.

Settlement multipliers: Village and Town (1.0×), City (1.1×), Capital (1.2×). The profit is in **carrying goods from where they're plentiful to where they're short**. Between two markets at par, a long haul to a capital about breaks even after the 200g hire. Luxuries or ironware hauled 10–20 hexes from a glut to a shortage repay 20–60%. A real dearth (bread or fish to a starving capital) can pay several times the cost, until your loads fill it.

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

Every smuggling run raises **heat** with the destination's crown (more if intercepted — see [The Underworld](#the-underworld)). Running goods into a **blockaded** realm pays half again as much (more if its port is sealed by enemy fleets) but adds 15% to the catch chance; the **lean season** adds another 15% to the take.

### Merchant Houses: the Trading Company

Caravans and routes are trade you run yourself. In the mid and late game you can found a **trading company**: a chartered house with its own name, capital, ledger and reputation, factors working for it in distant towns, supply contracts from the crowns, and rival merchant houses competing for the same markets. Open it from **Trading Company** in any town's action menu (shown once you have 1,500 gold, a charter, a royal office or a company).

**Charters.** A company needs a charter, which you can get in one of three ways:
- **Buy one** from a crown in one of its towns: 900g + 60g per town the realm holds (at most 2,400g). The gold goes to the royal treasury. The realm must not be at war with you, and your reputation with it must be 0 or better.
- **A royal office** carries the right to charter a company in the realm you serve.
- **At court**: the *Merchant Venturers* petition at your holdings (pop. 250+) can seal a charter for your House.

**Founding.** Put in at least 500 gold of capital. The company's capital is separate from your purse: use **Pay in** and **Draw out** on the Ledger tab to move gold between them. Capital moved in or out does not count as profit or loss. The company starts with 30 reputation, which drifts back up by 1 a week while it is below 30.

**Posts and factors.** In any town, open a **post** (350g, or ×1.5 for a foreign licence in a realm whose charter you lack; up to 6 posts) by hiring one of three factor candidates. Each candidate has:
- **Skill** (2–9): units handled per week = 30 + 8 × skill. The wage is 10g + 3g × skill per week, plus 5g rent for the post.
- **Honesty**, which is hidden. You see only the references people give, and they are not always right. A factor with honesty below 0.7 **skims** part of each week's turnover. After a few weeks of skimming the books "look thin". An **audit** (60g) finds the skim 85% of the time and claws back half of it. You can then replace the factor from the town's candidates while you are there.
- A factor who goes unpaid for 2 weeks quits, and the post sits idle.

Each post's warehouse holds 300 units. When you stand at a post you can **store** goods from your packs there (not stolen ones) and **take** goods out.

**Standing orders.** A factor handles up to 4 goods. Each order says *buy up to X a week while the price is ≤ P, sell up to Y a week while the price is ≥ Q, always keep N*. Once a week the factor sells, then buys. Factors never spend the company's last two weeks of wages and rent.

**Factors trade by your price rules.** A factor pays the market's price after *your* discounts (exactly what *Buy* would charge you), and sells for exactly what you would get (the season, your trade bonuses, tariffs, and the cap below what the goods cost here or next door). A factor's sale price is always below its buying price in the same town, so a post cannot buy and sell back at a profit. A post makes money in two ways:
- **Timing**: buy food after the harvest and sell it in the lean months.
- **Moving goods**: send stock from one post to another, or to a contract.

Food a factor sells goes into the town's granary. Contraband is never on a factor's books.

**Competition and theft.**
- A rival house with a post in the same town takes custom: your factor sells only 75% of his volume there, unless you hold the monopoly.
- Thieves rob a post's warehouse now and then, taking 20–50% of the stock (about a 3% chance a week, 5% where the guild operates, less behind strong walls). Robberies are likelier in towns where the guild operates, rarer behind strong walls, and likelier still with a crooked factor inside. If you are a Thieves' Guild member of rank 2 or above, the guild mostly leaves your posts alone (×0.3).

**Convoys.** From a post, **dispatch** goods to another post or to a contract town. The convoy goes by **ship** when both ends are ports (9 hexes a day, 0.6% risk a day) and by **caravan** otherwise (5 hexes a day, 1.2% risk a day). It costs about 0.08g per unit per day, minimum 5g. A struck convoy loses 40–100% of its load to bandits, storms or pirates.

**Supply contracts.** Each week the crowns post contracts on the company's board. Each one names a good, a quantity, a price per unit (1.25–2× the good's base price) and a deadline:
- **Bread (or meat) for a town** short of food: during a famine, drought, blizzard or plague, a hard frost or hoarded granaries (a saga such as the Long Winter), and in the lean weeks.
- **Relief for a besieged town**, at a war premium: a port an enemy fleet blockades, or one of your own holdings under siege, when a realm can pay for it. Food delivered to a besieged holding of yours also fills its siege stores.
- **Timber, rope, hemp or rock oil** for a realm with a fleet, or a realm whose coasts pirates harry (a pirate surge, the Sea Reavers).
- **Iron, weapons, arrows, horses or coal** for a realm at war.
- **Stone for new walls**, or **luxuries, gems or liquor for a court wedding**.

Most contract goods (rope, hemp, candles, shields, …) are never sold in a market: you make them in your own workshops and store them at a post. Others (weapons, gems, liquor, horses, meat, coal, rock oil) are sold only in some towns, so a post in the right market can buy them and convoy them on. A well-placed post at a capital, buying bread after the harvest and selling it in the lean months, and taking only contracts it can source, turns a modest profit (see `docs/economy-balance.md`).

The contract town never sells the good itself or next door, so the goods must be brought in. You can deliver by hand from your packs, from a docked ship's hold, from your post in that town, or by convoy. If a market there has since started selling the good, the pay drops below what the good costs there.

A fulfilled contract gives +5 to +10 company reputation and +3 reputation with the crown. A contract still short at its deadline is **broken**: −10 company reputation, −3 with the crown, and a *Broken Contract* rumour spreads from the town. A company needs 10 reputation to take contracts. A contract left on the board for a week or two may be taken by a rival house.

**Rival merchant houses.** 3–5 of the great houses (House Medrano, the Vanterpool Staple, Orsini & Sons, Grauwacke Ironmongers, the Lilywhite Fellowship, Karsk Fur & Amber, the Saffron Road Company) already trade from their seats and a few nearby towns. Which houses exist, and where, is fixed by the world. They act only once you have a company. Each week a house:
- earns or loses on its capital, and pays half its profit out as dividends;
- opens posts in nearby towns, and grows more hostile (**rivalry**) when you move into its towns, win its contracts or wage price wars;
- **lobbies for a monopoly** on one of its goods in one of its towns. In your own town it comes to your court with a purse, and you can grant the monopoly, refuse, or give it to your own company instead.
- A house with high rivalry **slanders** your company in your post towns: a *Merchant Slander* rumour and −2 company reputation.
- A house whose capital falls below 400g is **ruined**. Its posts close and its monopolies lapse. A newcomer may take its place.

On the Rivals tab you can:
- **Buy shares** in a house at 115% of its share price (capital ÷ 100), and **sell** them back at 85%. Flipping shares always loses money. Shares earn your part of the house's dividends.
- **Buy out** a house once you hold 51 shares, by paying for the rest. Its coffers fold into your company's capital and its monopolies pass to you.
- Start a **price war** (200g or more): the house loses 0.9–1.5× what you spend, but your company loses 3 reputation and the house's rivalry jumps.

**Monopolies.** A monopoly on a good in a town means nobody but its holder may buy or sell that good there: not you at the market, not your factor, not a rival. You can win monopolies in four ways:
- Granting one to the clothiers' guild in the *Clothiers' Charter* petition creates a real **textiles** monopoly (the five-year charter lasts 600 days). Revoking it when the guild overreaches reopens the trade.
- A rival can buy one from the crown.
- Your company can **lobby** for one at a post (👑 on an order): 600g + 0.4g per inhabitant, with 40 company reputation and 10 with the crown. The odds are 55%, ±0.4% per reputation point above or below 50. In a town you rule, it is half price and certain.
- Buying out a house passes its monopolies to you.

A company monopoly lasts 120 days. While it lasts, your factor there sells 25% more volume and rivals do not undercut him.

**Royal ventures.** Now and then a crown sells shares in a venture: a spice fleet, a whaling voyage, a silver mine or a long caravan east. Your company can stake capital in it, up to the venture's limit. The stake goes to the royal treasury. Some 30–80 days later the venture **comes home** (1.4–2.5× the stake) or is **lost** (0–40% salvaged). On average a venture returns a little more than it costs, at real risk.

**The Ledger tab** shows:
- capital, reputation, and the company's worth (capital, stock at sale value and shares);
- all-time profit and loss by category: sales, contracts, dividends, ventures, buy-outs against purchases, wages, rent, convoys, lobbying, robbery and so on;
- the last weeks' income, expenses and capital;
- the news of the trade;
- the latest ledger lines.

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

Choosing **Attack** on a settlement opens a panel with two options:

- **Raid** — fight only half the garrison, plunder its gold and withdraw. No conquest; karma -5, reputation -20 with the owning kingdom (-30 if the raid fails), population -10%. A raided settlement has nothing worth taking for **30 days**.
- **Lay Siege** — your army (50+ land strength) camps before the walls and the siege begins. Investing a town costs reputation -15 with its kingdom and karma -2, and is an act of war: unless your liege is already at war with that realm (or it is your own civil war), the realm declares war on you and its war hosts will march on your holdings. From then on the siege runs day by day: the action menu shows **Siege of …** (no AP to open), and the siege panel shows the day count, both sides' strength, stores and morale, the walls, your works and any relief army on the way.

**The defenders** have:

- a **garrison**: 3% of the population × the town's size (village 0.8, town 1.5, city 3, capital 5), plus 15% of the realm's army (40% at the capital) and a holding's stationed troops and militia;
- **walls**: +10% for a town, +30% for a city, +40% for a capital, plus a holding's walls and the realm's own defensive character. Their **integrity** (100%) falls to mines and trebuchets and is mended a little each night while the defenders are fed and in good heart;
- **food stores** in days: 10 (village) to 30 (capital), more after the autumn harvest, less in spring and the lean weeks, plus up to 20 days of granary reserve;
- **morale**: 70 (80 at a capital, +10 when a relief army is coming).

Each day the town eats a day of its stores. A **port** still fed by sea eats them at half pace, unless your war galleys or an enemy realm's fleet blockade it. Morale falls a little every day; once the stores are gone the garrison starves (−3% a day, −6 morale), and low stores or hunger can bring **disease** inside the walls (garrison and people die, morale falls). A garrison whose morale reaches 0 **surrenders**.

**Your stance for the day:**

| Stance | Effect |
|--------|--------|
| 🛡️ Blockade | Tighten the cordon: the town eats 25% faster and loses an extra point of morale a day |
| Siege works | Build one engine at a time (paid when you start). 🐏 Battering ram (60g, 3 days): the storm defence is 15% weaker. 🗼 Siege tower (150g, 6 days, needs Fortification): walls count half in a storm and cost half the men. 🏹 Trebuchet (300g, 8 days, needs Siege Engineering): batters the walls −6% a day. Siege engines in your army build 50% faster, a large army (6+ companies) 20% faster |
| ⛏️ Sap the walls | Dig a mine (10 days, 50% faster with Fortification). When it is fired 60% of the wall comes down. Each day the defenders may break in (6%), setting it back 3 days and killing a crew |

**Actions:**

- **Storm** (8 AP) — a battle with the usual combat rules against the garrison behind what is left of its walls: defence = garrison × (1 + walls × integrity), −15% with a ram, scaled down by low morale (to 55%), starvation (×0.8) and disease (×0.85). Scaling the walls costs up to 12% of your companies on top of the battle's losses (less as the walls come down, half with a tower). **Storm and hold** takes the town with the usual conquest: plunder, the old realm loses its army share (a capital moves, or the realm falls), the town goes to your liege — or, if you are sworn to no one, becomes your own holding; karma −10, reputation −50 with the owner and −10 with every realm, renown and House Prestige, a claim on the throne for a capital. **Storm and sack** loots it instead: 3–6 gold a head, a quarter of the people lost, happiness −20, karma −15, reputation −40 with the owner and −10 with all, cruelty, greed and dread deeds, and severity in your court reputation; the town stays with its realm. A failed storm costs the garrison 10% but lifts its morale (+8), drops your camp's morale (−15) and costs −10 reputation.
- **Offer terms** (2 AP, once every 3 days) — the chance shows on each button. It rises as the defenders' morale falls, when they starve, with your strength against theirs, your Diplomacy, traits that help negotiation (Honest, Cunning), a fearsome name (Dread Lord, Cruel) and a merciful or severe court reputation; it falls while a relief army is on its way. A refusal hardens them (+3 morale).
  - **Surrender with safe passage** (hardest): the town is taken without a storm — a little plunder, 5% of the people lost, karma −3, half the reputation loss; mercy and honesty deeds.
  - **Ransom**: the town (and its realm's treasury) pays about 1.2 gold a head, more when its spirit is broken, and you march away.
  - **Tribute**: 30% of the ransom now and 20% every week for 4 weeks.
- **Fight the relief host** (8 AP) — see below.
- **Hold the siege** ends the day; **Lift the siege** marches away. Marching more than one hex from the walls, being captured or losing your whole army also lifts it.

**Your camp** needs a ration for every 3 companies a day. The land gives some (most in summer and autumn, little in winter, less on barren ground, and less every day the army forages it); the rest comes from the food in your packs. A hungry camp loses 10 morale a day. Camp morale starts at 60 (+3 per Leadership) and also falls to boredom after 10 days and to sickness; ram, tower or trebuchet finished and a relief army beaten raise it. Under 30 morale, or after 3 hungry days, soldiers **desert** (not mercenaries). **Camp disease** grows likelier the longer the siege lasts (more in summer, when hungry, or when the town is sick; Medicine techs that resist plague help): for 5–9 days it may carry off a company a day, and you may catch the **Bloody Flux** yourself. Army upkeep is paid every day as usual.

**Relief armies.** When you invest a town its realm may send a relief host (40% for a village up to always for a capital, if its army is 60+): 35% of its army (30–300 strength). It is a real army on the map (🚩): it musters at the realm's capital (or, if you besiege the capital, its nearest other town) for a few days, then marches on the town at 3 hexes a day, taking the long way round water and mountains. The panel shows where it is and how many days away. You can **intercept** it: your army may stray one hex from the walls without lifting the siege, so meet it as it comes up (**Intercept the relief host** in the siege panel, or attack it from the map). Once it reaches the walls you may fight it or withdraw; if you do neither it attacks your lines the next day, with a sally from the garrison (a quarter of it, if their morale is 40+). Beat it, wherever you meet it, and the town loses heart (−25 morale); lose at the walls and the siege is broken. A host that can find no road for 8 days turns back. A host that goes home (or whose siege is lifted) returns most of its strength to the realm's army. Relief hosts are saved with the other units on the map.

**Throne wars.** In a war for a throne (see [Claims & Crowns](#claims--crowns-the-path-to-the-throne)) a loyalist town of that realm can be besieged too: taken by storm or surrender it declares for you instead of being conquered (+15 momentum, +40 for the capital). Towns that have declared for you can't be besieged.

Tuning lives in `data/military.json` → `sieges`.

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
| Siege | 50 | A campaign of days: hunger, disease, desertion, relief armies, a costly storm | Capture (holding or liege), sack, ransom or tribute — see [Sieges and Raids](#sieges-and-raids) |

Garrison strength scales with population, settlement tier, the realm's army and walls.

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
| Assassination | 400g | 6 days | 45 | 70% |

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

While a **Plague Outbreak** rages over the realm you stand in, you lose 6 health a day and each soldier has a 4% daily chance to die. Plague resistance (Herbalism + Plague Prevention = 55%, max 90%) cuts both by that share, and also your chance of catching the **plague** itself. Medicine techs also make physicians better: Herbalism +5%, Surgery +12% on wounds, Plague Prevention +8% on diseases, Hospital +10%. Knowing Herbalism yourself also helps you recover, and a Hospital you own nearby speeds healing.

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

## The Underworld

A criminal path through the realms, alongside the honest one. Everything here is driven by `data/underworld.json`.

### Heat

**Heat** is your notoriety with one kingdom's watch, from 0 to 100, shown per realm in the **Underworld** panel (and on the action itself: *Underworld (heat 34)*).

- **Raised by crimes:** pickpocketing (+3), burglary (+8), protection rackets (+6, then +3 a week), heists (+25), black-market deals (+2, scaled by how illegal the goods are), smuggling — by hand or by route (+2 to +4), piracy (+12 with the realm whose waters it was) and robbing caravans. Being caught raises it far more (+10 to +35).
- **Cools** by 1 a day everywhere. **Lie low** in a realm (from the panel) and it cools by 4 a day there for 3 days — but you take no jobs in that realm meanwhile.
- **Bribe the watch** (1 AP): pay to knock up to 30 heat off. The price scales with the heat and the town's guard strength; guild rank discounts it (5% per rank). About 1 in 10 sergeants takes the gold and reports you anyway (more in *orderly* realms, fewer if you are charming).
- Answering to the guards at the guard tower (settling your bounties) also cools heat to 20.

| Heat | Level | What happens |
|------|-------|--------------|
| 25+ | **Watched** | A warning as you enter its settlements; guards may **search** you at the gate |
| 50+ | **Wanted posters** | A bounty is posted on you (through the gossip system) |
| 60+ | **Arrest risk** | A search can end in arrest |
| 80+ | **Warrant** | A kingdom-wide warrant: merchants, taverns and recruiters there refuse you until you settle with the guards |

**Guard searches.** Entering a settlement in a realm where you are watched, guards may search you — the higher the heat and the bigger the garrison, the likelier. Never at the gate of your own holding: your watch answers to you. But a watchtower or walls and the troops you station there make every job, burglary and black-market deal *in* that town harder, as if its guard were stronger. They **confiscate** goods banned there and any **hot** goods, fine you (more for what they find), and may **arrest** you into the town jail (2+ days, bail available). A clean search cools your heat by 3.

**Guard strength** is village 1, town 2, city 3, capital 4, adjusted by the realm's character (*orderly* +0.75, *militaristic* and *defensive* +0.5, *secretive* −0.5, *mercantile* −0.25…).

### The Thieves' Guild

In any **town, city or capital** tavern, *ask the barkeep about "special work"* (30g) to meet a guild contact. The contact opens the **fence** and the **black market** to you; swearing the oath (100g) makes you a member.

**Ranks** rise with guild standing earned from jobs:

| Rank | Standing | Unlocks |
|------|----------|---------|
| Footpad | 0 | Working the crowd, the fence |
| Cutpurse | 20 | Burglary |
| Prowler | 55 | Protection rackets; you are now **known** as a guild man |
| Shadow | 110 | Heists |
| Master Thief | 190 | — |
| Guildmaster | 300 | A **weekly cut**: 150g + 25g per racket you run |

**Jobs** (from the Underworld panel, in towns and cities):

| Job | AP | Reward |
|-----|----|--------|
| Work the Crowd | 2 | 6–28g, more in well-guarded towns |
| Burgle a Merchant's House | 4 | 30–90g plus goods — **hot** |
| Protection Racket | 3 | A weekly payment from the town (4% of its population, 20–160g); one racket per rank. Heat 70+ in that realm risks the watch breaking it up |
| Heist | 6 | Hundreds of gold and rare loot (hot) — see below |

**Odds** = the job's base + 4% per Stealth point + the job's stat (Luck, Intelligence or Strength) + 2% per guild rank + **traits** (Cunning +8%, Deceitful +6%, Brave +2%, Honest −5%, Craven −3%) − 6% per point of guard strength − local heat. A failed job either comes away empty-handed or gets you **caught**: a fine, heat, a theft rumour that spreads like any other, and possibly jail.

**Heists** are planned before they are struck. Pick a mark — the Counting House or a Noble's Manor (towns), the Temple Vault (cities; costs karma), the Royal Treasury (capitals) — then take planning steps in that town within 14 days: **case the target** (+12%), **lockpicks & rope** (80g, +8%), **a crew** (140g, +14%), **an inside man** (180g, +16%), **the getaway** (60g, +5%, halves the arrest chance if it goes wrong). Then strike.

### Contraband & the Black Market

Each kingdom bans or tariffs goods according to its **culture and faith**:

- Everywhere: poison, forged documents and stolen goods are banned.
- *Religious* realms ban liquor and rum and tariff ale, mead and perfume; any realm whose faith runs deep (**piety 65+**) bans spirits too.
- *Desert* realms ban wine; *Woodland* realms ban ivory and tariff pelts; *Arcane* realms ban enchanted weapons; *Swamp* realms ban holy water; *Imperial* realms tariff weapons; *Mountain* realms tariff gems and gold; and so on.
- Faiths add their own: the Solar Covenant and the Starseers ban the **relic trade**; the Dunewalkers ban spirits; the Earthroot bans ivory.

The legal market **refuses** banned goods and pays **25% less** for tariffed ones (the crown's cut). The panel lists what is banned and tariffed in the realm you are in.

The **black market** (open once you have a guild contact) buys anything you carry that isn't hot, at a premium: ×1.05 for legal goods, ×1.35 tariffed, ×1.9 banned. A **blockaded** realm pays +0.5 more (+0.75 more again where its port is sealed by enemy fleets); in the **lean season** food fetches +0.35 and contraband +0.15. Each deal costs 1 AP and risks a raid — likelier with bigger garrisons, higher heat and under blockade, less likely with Stealth and a cunning character. Under blockade, deals raise twice the heat.

**Smuggling by hand** (Smuggle in a town, Stealth 2+) sells one unit per deal for 2 AP at 1.3× the black-market price, but never more than half what the goods cost on open sale here or next door. The odds are 50% + 6% per Stealth point, at most 90%. Getting caught costs the goods, a fine of half the price and jail that grows with each offence.

### Hot Goods & Fences

Goods you steal are **hot** for 10 days. The legal market and the black market won't touch them; only a **fence** will — at 50% of their worth (+4% per guild rank), no questions asked. Guards who search you seize hot goods. Loot still respects your carrying capacity: what doesn't fit is left behind.

### Consequences

- Crimes feed your **character traits**: Deceit and Cunning (toward *Deceitful* and *Cunning*), Greed, and for rackets Cruelty and Dread. Most cost a little **karma**.
- Being caught spreads **gossip** about you like any witnessed theft.
- A **known guild member** (rank Prowler or above, or caught at Cutpurse or above) is treated differently: guards, priests and nobles warm to you more slowly, beggars and travellers faster; *cunning*, *greedy* and *cruel* lords think better of you, *honorable*, *pious* and *cautious* ones worse.

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

### Crew

Every ship needs sailors (its **crew** stat). New and used ships come **without a crew** — hire sailors at a port from the ship's management panel (12g each to sign on) and pay them **1g per sailor per day** on top of the ship's upkeep.

- **Short-handed ships** sail slower (50% speed with no crew → 100% fully crewed; at sea each hex costs 2–4 stamina), fight worse (40% → 100% of combat strength) and haul fewer fish with Deep-Sea Nets.
- Below a **skeleton crew** (a quarter of the crew stat) a ship cannot leave port.
- **Morale** rests at 70 and scales combat strength (+15% at 100, −35% at 0). Storms at sea shake it and can wash a sailor overboard; a sea fight won lifts it (and may cost a sailor), a defeat costs 10–25% of the crew and a big morale hit. Paid crews recover toward 70, faster in harbour.
- **Missed wages** (not enough gold) cost 15 morale a day; below 25 morale, 10% of the crew deserts each day.
- **Sickness aboard.** If you sail with a contagious disease, it can spread to your crew. Weeks at sea without fruit or berries (in your packs or the hold) can also bring scurvy to them. A sick crew loses 2 morale a day and now and then a sailor, until the outbreak passes. It passes twice as fast in port.
- Ships from older saves keep a full crew at morale 70.

Tunables live in `data/ships.json` → `settings.crew`.

### Provisions

Ships away from port feed their crew from the **hold**. Each unit of food aboard (provisions, preserved fish, bread, grain, fish, fruit and other food) feeds **4 sailors for a day**, so a Trading Cog with 8 hands eats 2 units a day. A crew in harbour eats ashore and touches nothing.

- **Buying provisions.** A docked ship's management panel has **🍞 Provision for 10 days**; the Voyage menu offers **Victual & Sail**. A port's chandler charges 1.5× the town's food price (at least 6g a unit). Provisions take up hold space like any cargo.
- **Days remaining** are shown on every ship panel (🍞): the fleet list, the ship's panel, Board Ship and the voyage panel.
- **Running out.** A crew with nothing to eat loses up to 8 morale a day. After **3 hungry days** scurvy breaks out aboard (see Sickness aboard). Once morale falls below 25, sailors desert every day.
- **The captain's table.** If your own packs are empty while you're aboard, you eat a day's ration from the hold.

Tunables live in `data/ships.json` → `settings.provisions`.

### Voyages

From **Board Ship** at a port, **🧭 Voyage to a Port** lists every port your ship can reach **by sea** (a route over open water; a port on another sea isn't listed), with the distance in leagues, the days it will take, and what the days will cost. A voyage takes **real days**: each day the ship sails her speed in hexes (her crew and fittings count) along the route, and a full day passes: wages, upkeep, rations, morale, the weather and storms (a storm **halves** the day's run), interception by hostile royal fleets, and sickness aboard. Nothing is paid up front.

After each day the **voyage panel** shows the ship's log, the provisions left, morale, crew and hull. A quiet day sails on by itself. On a day worth stopping for (a storm, a fight, hunger, desertion, or an event at sea) you choose:

- **⛵ Sail on**: another day at sea.
- **⚓ Heave to**: end the voyage where you are and take the helm yourself (still aboard). From there you can sail by hand, row ashore or explore.

If you steer off the route by hand, the ship plots a new one from wherever you are. Going ashore (Disembark or Row Ashore) ends the voyage. When you make port, the ship docks with her hold as you left it and the panel shows the full log of the passage.

**Board & Take the Helm** still lets you sail by hand, hex by hex, using stamina.

**Expeditions** (in the same Voyage menu) sail toward a rumoured or charted uncharted place, or out into open sea far from every port, and end at sea with you at the helm (see [Uncharted Lands](#uncharted-lands)).

### Events at Sea

On each day of a voyage there is a 30% chance of an event. Each offers choices; an event left unanswered takes its default choice the next day. Events tie into morale, crew, cargo, provisions, hull, gold, renown, karma, traits and the underworld:

| Event | Choices |
|-------|---------|
| 🌫️ Becalmed | Wait (a day lost) · Man the sweeps (morale) · Whistle for a wind (luck: 50%, ±6% per point of luck above or below 5) |
| ⛵ Sail Ho! | Hail her (news, or pirates) · Run (may be caught) · Run her down: piracy costs karma, reputation and heat |
| 🏚️ A Derelict | Board her (a day; loot, or the flux aboard) · Strip her timbers (hull repair, timber) · Pass by |
| 🐍 Coils in the Swell | Hunt the serpent (a hard fight: renown and Valor) · Steer wide (a day) · Laugh it off |
| 🆘 Man Overboard | Come about (Mercy, morale) · Hold your course (a sailor lost, Cruelty) |
| 🔥 St Elmo's Fire | Proclaim a blessing (morale, Piety) · Pray (karma) · Ignore (morale) |
| 🚢 A Convoy Asks for Escort | Escort (a day; pay, perhaps a pirate fight) · Decline · Demand protection money (gold, karma, heat, Greed) |
| 🏊 A Castaway | Take him aboard (a new hand, Mercy) · Sail past (Cruelty) |
| 🏴 Smugglers' Lugger | Buy her wine (cargo, heat) · Report her (renown, Honesty) · Ignore |
| 🐟 A Great Shoal | Cast the nets (provisions) · Press on |
| 🌁 Fog Bank | Feel your way (may scrape a reef) · Heave to (a day) |
| 😠 Grumbling Below Decks (low morale) | A bonus per hand · Extra rations · Flog the ringleader (Dread, or worse) · Let them grumble |
| 🍾 A Message in a Bottle | Read it (a cache, or a love letter) · Leave it |

The event table lives in `data/ships.json` → `voyageEvents` (effects: morale, crew, gold, renown, karma, hull, repair, delay, cargo, provisions, heat, trait deeds, piracy, sickness, chance rolls and fights); voyage tunables in `settings.voyage`.

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

- **Exports** — cheap to buy (70–90% of the good's base price), but the port pays only three quarters of that.
- **Imports** — the port doesn't sell it but pays a premium (115–150% of base).
- **Local market** — buys and sells around the base price (90–110%), with a spread.

Port prices are on the **same scale as the land economy**: each good's base price is its land base price (silk 80, spices, wine and ivory 45, gems 60, iron 20, timber and fish 8), moved by the season as on land. For goods the town keeps in its own store (fish, timber, iron, gems, spices, wine), the port starts from what the town's stock makes them worth. A town with a glut exports the good, and a town in dearth imports it. Cargo you buy comes out of the town's store first, and cargo you land goes into it, so a big cargo of something the town already has fetches less a unit. Other roles are fixed per port; prices drift every 7 days. A town whose own market stocks a good (timber, gems) never imports it by sea. Buy where a good is exported, sail, and sell where it's imported. The margin comes from **distance and risk**: days of wages, upkeep and rations, storms, pirates and royal fleets, blockades and the season. The hold's cargo capacity caps how much each run carries. Carrying an export inland pays about what the land markets pay (70% of base), so it's no shortcut.

**No buy-and-sell-back.** No outlet (a port, the town market, a fence or the black market) pays more for a good than it costs to buy on the same tile **or in a settlement on the next hex**.

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

### Uncharted Lands

The map is generated whole at the start, but a few places in it are on **no map**: remote islands, hidden coves, lost valleys behind high ground, and sunken reefs. On the first day the game picks them from the map itself: unclaimed islands and coasts far from any town, and unexplored valleys ringed by hills and mountains. About a dozen are hidden, and the same world always hides the same places. Until someone finds a place it doesn't show on your map, even if you have sailed past the hex.

**Finding them**

- **At sea.** Each day aboard, a place within **5 leagues** may be sighted (25% a day, +20% in open sea at least 5 leagues from any port, +30% if a rumour or chart points to it; better lookouts and exploration fittings help). Inland valleys can't be seen from the sea.
- **Expeditions.** From **Board Ship → Voyage**, the **🗺️ Expeditions** list offers voyages toward a rumoured or charted place, or into the **open sea** farthest from every port within 45 leagues. An expedition is a normal voyage (days at sea, rations, events), but it ends **out at sea** with you at the helm instead of in a port.
- **Explore the Waters** finds the nearest uncharted place within 16 leagues of your ship far more often than random chance would (35%, +35% with a rumour or chart, more the closer it is). Otherwise it rolls the usual sea events.
- **On foot or aboard, close by.** Coming within **2 hexes** of a place finds it. This is how lost valleys are found.
- **Tavern notice boards** sometimes carry a rumour of a place within 30 leagues ("a drunk sailor talks of a hidden cove somewhere to the west…"). The rumour shows as a faint ❔ on your map within about 5 leagues of the real spot.
- **Ancient and treasure maps.** About half of ancient maps and a quarter of treasure maps mark one of these places when you read them. The ❔ then sits on the exact hex.
- **Rival adventurers** go looking too, from day 30. A rival who finds a place first names it, gains renown, and sells the chart to the nearest realm. You hear the news, and the place appears in your log as theirs.

**Naming and claiming.** Whoever finds a place first names it. You choose from three or four generated names (one carries your family name) in **Journal → Discoveries**. If you don't choose within 3 days, it keeps the first. Finding a place earns renown (8–12), counts toward the Seafaring/Travel and Learning traits, and naming it adds Prestige (4–6) and an entry in the **House chronicle**. Found places are drawn on your map with their names.

**What's there**

| Place | Exotic goods | Often |
|-------|--------------|-------|
| 🏝️ Remote Island | Ambergris, Cloudpepper, Sea Silk | natives, ruins, storms |
| 🌊 Hidden Cove | Pearls, Sea Silk | natives, ruins |
| ⛰️ Lost Valley | Ghost Orchid, Golden Amber, Cloudpepper | natives, ruins, sickness |
| 🐚 Sunken Reef | Pearls, Blue Coral, Ambergris | a wreck to salvage, reefs, storms |

- **Exotic goods** (95–140g base) are sold by **no market and no port**. They come only from these places, and any town market buys them at the usual 70% of base. Use **🧺 Gather** in the Discoveries log while standing on the place, or aboard right beside a reef, to take up to 4 of each into your packs once a day (the inventory cap applies). A place holds up to 6 of each and regrows one every 4 days.
- **Natives:** one of the Peoples (Tidecallers, Reefbuilders, Skyherders and others) living as a tribe on the place. You can trade with them and pay them tribute as with any tribe (see [Colonization](#20-colonization)).
- **Ruins** become a delve site (sunken halls on beaches and islands, ruins inland). A reef's **wreck** gives 40–160g of salvage to whoever finds it.
- **Hazards:** an uncharted **reef** may scrape the hull of the ship that finds it (6–16%; charted reefs are safe). **Storms** around a known place may batter a ship that sails within 2 hexes. **Sickness** (the flux, or marsh fever in valleys) may take you the first time you go ashore.

**Selling or keeping the secret.** Standing in a realm's town, city or capital, you can **sell the chart** of a place you found to its Royal Archive: 150–260g by kind, +25% for each good, people or ruin there, halved if another realm already knows of it, and less from an archive that has caught you selling doctored maps. You also gain +3 reputation with that realm. A realm that knows of a place sends its own traders, who take from its stock, and it may **claim** it (a 🚩 in the log). Gathering on a realm's claim costs 2 reputation with that realm. A place you keep secret is yours alone unless a rival stumbles on it.

**Settling.** Standing on a found place, **🏕️ Found a colony here** founds a colony named for it (see [Colonization](#20-colonization)), and any colony of yours within 3 hexes also claims the place. A claimed place is yours alone: no one else takes from it, and its stock grows to 16 of each good, one a day. A realm that knows of the place may **contest** your claim. You can pay its tribute (250–600g) within 20 days, or face its ships. When the 20 days are up, your ships, war galleys and the colony's garrison are matched against about half of that realm's navy. Win, and you gain +10 renown and the realm gives up its claim. Lose, and the colony and the place pass to that realm, and you lose 10 reputation with it.

Tunables live in `data/discovery.json`.

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
- A **holding** (a colony, or a town you hold in your own name) is **besieged** day by day — see [Holdings Under Siege](#holdings-under-siege) below.

A war host attacks you when you're next to it, and you can attack it yourself. Breaking a host gives +30 war score and Prestige. Each holding you lose costs −20 war score, and a holding that holds out gives +10.

**Ending the war**, from Dynasty → House → Wars & Ultimatums:

- **Buy peace.** 200 + 40% of the enemy's military, minus 10 gold per point of war score (at least 100).
- **Demand peace.** Needs a war score of 50 or more. The enemy pays you reparations (100 + 20% of its military), and you gain Prestige.
- **Exhaustion.** After 150 days with no host in the field, the war ends by itself.
- **The enemy falls.** If its kingdom is destroyed, the war ends.

A 120-day truce follows any peace.

### Holdings Under Siege

A war host that reaches one of your holdings camps on its tile and **invests** it. A banner under the top bar (and a red ring with ⚔️ and the day count on the map) shows every holding under siege; click it for the **Holdings Under Siege** panel, also linked from Manage Holding. Every notice reaches you wherever you are.

**The defenders** have:

- a **garrison**: the colony's own guard (10 if it has none), 1% of the people, the stationed troops and the militia;
- **walls**: the holding's defence (palisade, stone walls, watchtower, the governor's martial skill), with an integrity the besiegers batter down;
- **food stores** in days, reckoned as for a town you besiege: its size, the season and the lean weeks, plus up to 20 days in the granary. A **port** eats them at half pace unless the enemy realm has a fleet (navy strength 10+) to close the harbour;
- **morale**: 45, plus the town's happiness and loyalty above or below 50, the walls, and a governor's martial skill and loyalty (15–95).
- **the crown** (if you rule a realm): your royal Marshal adds garrison and morale and your Steward food stores (see [The Royal Court](#the-royal-court)), and the edict of fortification adds +0.15 to the walls of holdings in the realm and of your own colonies.

**Each day** the town eats a day of stores and loses a point of morale (a governor's martial skill slows that). Starving, the garrison loses 3% a day and 6 morale; low stores or hunger can bring **disease** (garrison and people die, morale falls). Your army within 4 hexes, half as strong as the besiegers or more, heartens them (+2 a day).

**The besiegers** build a **ram** in 3 days (the walls then count 15% less), then batter the walls 4% a day. From day 3, with the ram up, they **storm** when the odds are good: half the time at 1.5× the storm defence, one day in five at even odds, and now and then against a starving town. A failed storm costs them 15% of their men and heart and lifts the town's (+8). They carry 18–28 days of food; when it runs out they lose 4% a day and 5 morale. Their camp can fall sick too, and boredom sets in after 15 days. They **give up** when their morale is gone, when they are down to 40% of their strength, or after 60 days.

**Your options:**

| Option | Effect |
|--------|--------|
| ⚔️ **Relieve it** | March your army to the holding (within a hex) and fight the war host there with the usual combat — or just march up: the host attacks you when you're next to it. If the town's morale is 40+, a quarter of the garrison sallies to help. Win and the siege is lifted (+30 war score, Prestige, +10 loyalty, +5 happiness); lose and the town's morale falls 10. |
| 📦 **Send supplies** | A caravan (4 hexes a day, 30% chance the besiegers catch it) or, to a port, a ship (6 hexes a day, 12%, +35% if their fleet is at sea; you need a ship) carrying food from your packs and/or gold. Each day's worth of food (1 per 50 people, at least 4) is a day of stores (+3 morale); every 10 gold hires a man inside, every 25 gold a point of morale (up to 15). Caught supplies feed the besiegers instead. |
| 🗡️ **Order a sally** | The governor (or the garrison captain) leads 40% of the garrison against part of the lines. Martial skill and morale weigh in. Win: the besiegers lose 12% of their men and 12 morale and their ram burns; lose: 40% of the sally is lost and morale −10. Once every 4 days. |
| 🤝 **Governor's terms** | The governor offers the besiegers your gold (about 2 per besieger, more while their spirits are high) to march away. The chance rises as their morale falls, when they are hungry, with the governor's intrigue and stewardship and with a strong garrison. A refusal costs 3 morale; once every 3 days. |
| 💰 **Pay them to lift it** | Half the war's peace price plus 1.5 gold per besieger, paid into the enemy's treasury. The host goes home; the war goes on. |
| 🕊️ **Buy peace** | The war's peace price (see below): the war ends and every siege it brought is lifted. |
| 🏳️ **Let it fall** | The gates open and the town goes to the enemy. |

**Outcomes.** *Relieved* (the host broken), *held* (the besiegers give up: +10 war score, +5 loyalty), *bought off* (terms or payment), *lifted* (peace), or *fallen* — stormed, starved into surrender (morale or garrison at 0) or yielded. A fallen holding joins the enemy realm (−20 war score); its stationed troops and governor are lost as with any lost holding. Otherwise the garrison's losses fall on the stationed troops. Every siege goes into the House chronicle, and the panel lists your last sieges and how they ended. Another host that arrives joins the siege. Tuning: `data/military.json` → `holdingSieges` (built-in defaults otherwise).

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

### Claims & Crowns: the Path to the Throne

Serving a crown is not the end of the road. Open **Dynasty → 👑 Claims & Crowns** (or the **Claims & Crowns** action at any settlement once you have business there) to see your claims, the succession crises in the world, your war for a throne, and the realm you rule. Tunables live in `data/throne.json`.

#### Earning a claim

A claim on a kingdom's throne has a **strength** from 0 to 100, the sum of its sources: **Weak** (under 25), **Fair** (25+), **Strong** (50+), **Ironclad** (75+).

| Source | Strength | How |
|--------|----------|-----|
| 💍 Royal marriage | 30, +8 per child (up to +24) | **Royal match** (20 Prestige + 500g dowry, 20+ reputation with the realm): the eldest unwed prince or princess (16+) of the ruling house is promised to you and waits at the capital, already fond of you (70 affection). Court and wed them there as usual. |
| 📜 Forged documents | +15 each, up to 30 | 300g and an idle spy. The chance is 40%, +10% per spy level above 1, +2% per point of Stealth (5–90%). A caught forgery costs −15 reputation with the realm, −10 spy loyalty and +5 rival feud. |
| 🏛️ Royal office | 10 / 20 / 30 | Hold an office in your liege's realm long enough: an Official office 360 days (10), a Lord's office 240 days (20), Chancellor 180 days (30). |
| ⚔️ Conquest | 35 | Storm a living kingdom's capital (the court flees to another town). |
| 🛡️ Heralds and genealogists | +15 each, up to 30 | 30 Prestige. |

Claims on a realm that falls lapse.

#### Succession crises

When an AI ruler dies, the succession may be contested. The chance depends on who inherits: a **regent** (spouse) 60%, a **distant relative** 80%, a **young heir** (under 20) 35%, an already **disputed** succession 100%, an ordinary heir 8%. A restless realm is likelier to split: ×(1 + (50 − stability) ÷ 100). A crisis lasts **60 days** and costs the realm −10 stability while it runs.

Two claimants contend: the incumbent (support 35–60, by how the throne passed) and a rival of the blood (25–45). You may back **one** of them:

- **Gold:** 200g or more, +1 support per 50g.
- **Prestige:** 10 Prestige for +12 support.
- **Fight for them** (2 AP): battle a vanguard of about 8% of the realm's army (20–400). A win adds +15 support.

When the crisis ends, the winner is drawn by support. If your claimant wins you get your gold back ×1.5 plus 200g, +30 reputation and +15 Prestige; if not, −20 reputation. A victorious rival takes the throne. If you hold a claim on that throne yourself, you may **press it** during the crisis instead, and the realm leans your way (+15 appeal).

#### Pressing a claim: civil war

With a claim of **25+**, a land army of **40+** strength and **300g**, you can **raise your banners**. If you were sworn to that crown, your oath is broken and you resign any office.

Every town and every great lord of the royal council chooses a side, by your **appeal**:

- claim strength ×0.5, reputation with the realm ×0.25, Prestige ÷ 5 (up to +15),
- the ruler's opinion of you ×0.3 (±15; it includes your court rulings and marriage ties) and your earned traits (±10),
- unrest: (60 − stability) ×0.3, a succession crisis +15, your army ÷ 20 (up to +15),
- minus 35 for loyalty to the crown.

A town adds its own local temper (±12), +0.5 per hex from the capital (up to +10) and +8 if you own a property or house there. The capital stands 25 firmer, and the court holds it at the outset whatever its mood: it falls last. A great lord adds his own temper (±10), minus half his loyalty above 50. Anyone above zero rises for you. Each claim card shows today's forecast, town by town and lord by lord.

The civil war:

- **Levies.** The rebel towns bring 80% of their share of the royal army, taken from the crown. Starting **momentum** is (rebel share − 50%) × 60, +3 per great lord who joins you.
- **Loyalist war hosts** march on your holdings, as in any war against you (§16). Each host you break adds half its war score to your momentum (+15); a holding lost costs −10.
- **Field battles** about one day in three. Your odds are (levies + your army) against 60% of the loyalist army, ± momentum ÷ 400 (10–90%). A win gives +6 momentum, costs the loyalists 5% of their army, and 35% of the time a loyalist town declares for you (the capital last). A loss gives −6 momentum, costs 7% of your levies, and a town may go back to the crown.
- **Lead the assault yourself** (2 AP): fight a loyalist vanguard (8% of their army). A win gives +10 momentum and turns a town; a loss gives −8.
- **Besiege a loyalist town**: taken by storm or surrender, it declares for you (+15 momentum, +40 for the capital) — see [Sieges and Raids](#sieges-and-raids).
- The realm drifts toward whoever holds more of it, by (rebel share − 45%) × 2 a day, and loses 15 stability while the war lasts.
- A war for a throne can't be bought off or ended by demanding peace.

**Victory** comes at momentum **100**, or when every town (the capital last) has declared for you: you are crowned (King or Queen), with +50 Prestige, +60 renown and reputation of at least 50. The rebel levies rejoin the royal army.

**Defeat** comes at momentum **−100**, after 10 days with almost no levies (under 10) and no army (under 20), or if you **abandon the claim**. After 360 days the war ends either way: momentum 30+ wins the crown, anything less loses. Defeat means **exile**: the claim is gone, −30 Prestige, reputation with the realm falls to −80 or lower, and for 360 days you can't seek or press a claim there.

#### Ruling a realm

As ruler you are the realm's sovereign, and the crown passes to your heir with the House. From Claims & Crowns:

- **The royal levy.** Each day you take a share of what the royal treasury gained since the day before: 8% (light taxes), 15% (standard) or 25% (heavy), at most 200g a day and never below a 500g reserve. A day of war spending or tribute paid brings nothing. It shows in your finances as *royal levy*.
- **Policies** feed the kingdom's AI (through its bonuses):

| Policy | Option | Effect |
|--------|--------|--------|
| Taxes | 🍃 Light | −10% tax income, +6 stability, levy 8% |
| | ⚖️ Standard | levy 15% |
| | 💰 Heavy | +10% tax income, −8 stability, levy 25% |
| War stance | 🕊️ Seek peace | The AI declares no wars, and each day there is a 5% chance per war that your envoys win peace. +3 stability, +10% diplomacy |
| | 🛡️ Defensive (default) | The AI declares no wars without you. +5% defense |
| | ⚔️ Aggressive | The AI may declare war as it likes. +5% battle, −3 stability |
| Faith | 🤝 Tolerant | +3 stability, −10% faith, +5% trade |
| | 🙏 Devout (default) | No change |
| | 🔥 Zealous | +20% faith, +5% loyalty, −3 stability |

- **Diplomacy as the realm:** declare war (not on allies, not during a truce); propose peace (35% + 25% × (your army ÷ theirs − 1), 10–90%; a refusal closes their door for 10 days); propose an alliance (both crowns at 40+ relations; relations rise to 75); send royal gifts (300g from the treasury: their relations +10, yours +5).
- **Abdicate**, and a ruler of the old dynasty takes the throne.

Your stand-in on the throne never dies of NPC old age or court events. If the realm is conquered, the crown is lost.

#### The Royal Court

A crown is a realm to govern, not just a title. Open **🏛️ Royal Court** (an action at any settlement while you rule, or the button in Claims & Crowns). At the end of your first day as monarch the realm's lords come to swear fealty. The court has four tabs: **Council**, **Edicts**, **Vassals** (with their factions and any revolt) and **Realm** (treasury, army, stability, faith, wars, what the court adds to the realm, and the court's chronicle). Tunables live in `data/kingship.json`.

**The royal council.** Five great offices, each filled from your **vassals**, the **old court's** great officers, your **family** (spouse, grown children at home) or your **companions**. Each holder has a **competence** (1–20) and a **loyalty** (0–100). An office's bonus is competence × a loyalty factor (0.25 + loyalty × 0.0125: ×1 at 60 loyalty, at most ×1.25). A vassal's loyalty follows his opinion of you; a child's comes from the House role loyalty (75 by default); a companion's is their approval.

| Office | Competence from | Per point of competence |
|--------|-----------------|-------------------------|
| 📜 Chancellor | diplomacy (a child's diplomacy and charisma) | +2% diplomacy, +1% relations, +1% peace odds; at 12+ the court can enforce one more edict |
| ⚔️ Marshal | martial (a child's combat and strength) | +5% army regrowth, +0.6% army size; a holding of yours that comes under siege gets +1.5% garrison and +0.5 morale (× his loyalty factor) |
| 💰 Steward | stewardship (a child's commerce and intelligence) | +1.2% treasury income, +0.5% construction; a holding of yours that comes under siege starts with +1.5% food stores (× loyalty factor). Below 25 loyalty the steward skims. |
| 🗝️ Spymaster | intrigue (a child's stealth and intelligence) | +2% intrigue (fewer peasant rebellions), +1.2% a day to reveal each hidden faction (3% with no spymaster) |
| 🙏 High Priest | learning, +5 if Pious (a child's diplomacy and faith) | +1.5% faith, and faith unity rises toward 50 + 2.5 × competence |

A companion's competence is 7, +6 if their trade suits the office (a priest as High Priest, a knight as Marshal, a merchant as Steward…), +3 if devoted. One person holds one office. A lord on the council thinks better of you (+15); an ambitious lord (7+) resents family or companions in the great offices (−5).

**Edicts** are realm-wide decrees. Proclaiming one costs the royal treasury; most cost daily **upkeep** until revoked, and lapse if the treasury cannot pay. The court can enforce 4 at once (5 with a Chancellor of 12+). Each edict shifts the kingdom's bonuses (and so its income, army, stability and AI), the **council factions** (half the shift is undone on repeal), and how your **vassals** see you: every lord whose goals it serves likes it (+8), every lord whose goals it offends hates it (−10).

| Edict | Cost / upkeep | Effect | Factions | Lords who like / hate it |
|-------|---------------|--------|----------|--------------------------|
| ⚔️ Conscription | 150g | +15% army, +30% regrowth, −4 stability; −4 all lords | War Hawks +8, Commons −10 | domination, conquest / wealth, trade, peace |
| 🛣️ Road-building programme | 200g, 30g/day | +12% trade, +15% construction, +5% expansion; roads and bridges you build in the realm cost 40% less | Guilds +6, Commons +2 | trade, colonising |
| 🤝 Religious tolerance | 100g | +3 stability, +4% trade, −8% faith; minorities' mood +2 a week; faith unity −0.05 a day | Clergy −10, Commons +4, Guilds +4 | trade / faith |
| 🔥 Persecution of heretics | 100g, 10g/day | +15% faith, −5 stability, −4% trade; faith unity +0.1 a day; minorities' mood −3 a week | Clergy +10, Commons −6 | faith, fear / trade |
| 📜 Merchant charters | 150g | +15% trade, +10% caravans, −4% taxes; a trading-company charter from the realm costs half | Guilds +10, Nobility −5 | trade, wealth |
| 🍞 Famine dole | 100g, 8g/day + grain | +2 stability; feeds hungry towns (below) | Commons +10, Clergy +3 | justice, faith / wealth |
| 💎 Crown monopolies | 200g | +15% treasury, −10% trade; −3 all lords; real monopolies on salt, iron, wine, tools, weapons and liquor in every town of the realm (below); rival merchant houses earn 1% a week less per post in the realm | Guilds −12, Nobility −4 | — / wealth, trade |
| ⚖️ Royal assizes | 150g, 20g/day | +5 stability, +5% loyalty; −3 all lords | Commons +5, Nobility −6 | justice / fear, domination |
| 💰 Scutage | 100g | +8% treasury, −10% army; +4 all lords | War Hawks −8, Nobility +4 | wealth / domination, conquest |
| 🎭 Royal patronage of the arts | 150g, 25g/day | +30% culture, +15% research, +5% diplomacy; +2 all lords | Nobility +4, Clergy +2 | alliance |
| 🏰 Fortification of the marches | 200g, 35g/day | +15% defense; +2 all lords; your holdings in the realm (and your own colonies) face a siege with +0.15 walls | War Hawks +4 | survival |

Tolerance and persecution exclude each other, as do merchant charters and crown monopolies, and scutage and conscription.

- **Crown monopolies** are real town monopolies. Every town of the realm gets one on each crown good it does not already have a guild's or merchant house's monopoly on. While they stand, the town's market asks **30% more** for those goods. You may still buy them, and the markup you pay goes into the **royal treasury** each day. No trading company, including your own, may buy or sell them there. They are lifted when you repeal the edict, when the town leaves the realm, or when you lose the crown. The Deeds ledger counts the money they bring in.
- **The famine dole** responds to real hunger. Each day it ships grain to every town of the realm that is short of food. A town counts as short in the **lean weeks** (or while lean-season unrest is still felt) if it has less than 5 days of stores, and in any town a **Hungry Months** famine reaches. Grain tops the town up to 5 days of stores (8 in a famine; a town in famine gets at least a day's bread). Each town gets at most 60 units a day, at **0.6g a unit** from the royal treasury, so the cost follows the hunger. A fed town gets back up to 1 point a day of the happiness it lost to the lean season. In a famine, the dole also returns the people the famine would have cost the town and adds up to +2 stability a day across the realm. If the treasury can pay for only part of the grain, the relief shrinks to match, and you are warned once that the dole is running short. In good times it costs only its upkeep.

**Vassals.** One lord for each town of the realm other than the capital (up to 8; landless lords make up at least 3), each with an NPC lord's personality (traits, goals, ambition and honor) and a courtier's skills. New towns gain a lord within a month; a lord whose town is lost becomes landless; old lords die and their heirs inherit.

- **Power** (0–100): 8, plus 0.6% of his town's people (up to 30), +10 for a city, +4 for a town, +1.2 per point of martial skill, +10 per grant of land and +5 per title. A landless lord starts from 6.
- **Opinion** (−100 to 100) drifts each week 30% of the way toward a target built from his temperament (traits, honor, ambition), the royal levy (light +10, heavy −15), your edicts, a council seat, kinship with your House (+25), the realm's stability, your Prestige (up to +10), your wars (+4 each for a warlike lord, −4 for a peaceable one), and his **favours** (decay 10% a week) and **grudges** (5% a week). The Vassals tab shows each reason.

Win them over:

| Action | Cost | Effect |
|--------|------|--------|
| 💰 Gold | 250g from the treasury | +15 favour |
| 🎖️ A title (up to 3) | 10 Prestige | +20 favour, +5 power |
| 🌾 Crown land (up to 2) | the crown's own taxes −2% each | +30 favour, +10 power |
| 💍 A marriage | 15 Prestige + 300g dowry, a grown unwed child (not your heir) | kinship: +25 opinion for good |
| 🍖 A royal feast (every 30 days) | 500g from the treasury | +8 favour to every lord, +2 stability, +3 Prestige |
| 🤝 A favour (every 14 days per lord) | 120g of your own | +10 favour; his nearest neighbour −4 |

Or **break** a lord whose power is no more than half the crown's (a base of 30, plus 5% of the royal army, plus half the power of every loyal lord): he loses his lands and titles and 60% of his power, takes a −60 grudge and is cowed for 180 days (he joins no faction); every other lord takes a −5 grudge, the realm −3 stability, and you +5 Prestige.

**Factions.** Each week a lord at −15 opinion or worse, not cowed, may join (or found) a faction behind a **demand** his goals suggest: a lighter levy, an edict passed (charters, persecution, assizes, conscription, fortification, roads) or one repealed (monopolies, tolerance, conscription, scutage, assizes). The chance grows with his ambition and his anger. A lord whose opinion climbs back to +10 leaves. A faction disbands the moment its demand is met.

Factions form in **secret**. Each day each hidden faction has a 3% chance to be revealed, plus 1.2% per point of your Spymaster's competence. A **revealed** faction whose **threat** (its lords' power against the crown's) reaches 30% delivers an **ultimatum**: 15 days to meet its demand. You can **concede** (its lords +15 favour) or **arrest its leader** (if he could be broken; the others take a −6 grudge). If the ultimatum runs out, a faction at 45% threat or more **revolts**; a weaker one **refuses the levy** for 60 days (each lord's power withheld from your taxes and army, and a −10 grudge). A **hidden** faction at 45% threat may rise without warning (35% a week).

**Revolt** is a civil war inside your realm. The rebel lords take their levies (1.5 per point of power) from the royal army and raise a host of 4 per point. While it lasts the realm loses 12 stability, the crown's taxes fall by half the rebel towns' share of the realm's people, and other crowns smell weakness.

- About every 15 days the rebels send a **war host** (30% of their strength, 25–200) at the nearest loyal town. Taken, the town joins them (−15 momentum); repelled, the host scatters (+10). A town that is one of your own holdings also fights with its garrison and walls; if it falls it is sacked (+25 unrest, a quarter of its garrison and 5% of its people lost) but never joins the rebels, and a holding already besieged by a foreign war host is left to that siege. Meet a host in the field and break it: **+15** momentum.
- The **royal army** meets the rebels in the field about one day in four (±8 momentum, losses on both sides).
- **Besiege a rebel seat** with your own army (the realm sends no relief against itself). Taken by storm, surrender or sack, it returns to the crown and its lord is broken: **+20** momentum, **+40** for the leader's seat.
- **Crushed** at momentum 100 (or once the rebels have no men or seats left): every rebel lord is broken, +25 Prestige, +6 stability.
- **Conceded** at momentum −100, or if the rebels take the capital: their demand is forced on you, the leader gains a title, −30 Prestige, −10 stability.
- **Parley** at any time: grant the demand and pay 3 gold per point of rebel strength from the treasury (−10 Prestige; the rebels +20 favour).
- After 240 days it ends in whichever side's favour momentum stands.

**Royal petitions.** As monarch you also hear the realm's own business at its capital: who comes after you (the succession), envoys from your worst-disposed rival crown, offers of friendship from your best-disposed one, border disputes, plague in the capital, lords pleading poverty, veterans' arrears and royal tournaments. Their choices move the royal treasury and army, your lords' favour and the relations of foreign crowns, as well as the usual Prestige, renown, stability and council factions.

**Other crowns** treat your realm as a real power. Once a week each one weighs it: a neighbour (capitals within 28 hexes) envies a crown more than 1.2× its might (−2 relations, −3 for an ambitious lord); a peaceful or mercantile realm on good terms warms to a stronger one (+2); when yours is the mightiest realm, wary crowns ally against it; and a hostile neighbour (relations −20 or worse) declares a war of conquest when its might × its lord's war appetite exceeds 90% of yours, or only 60% while you face a revolt or a civil war or your stability is under 35.

#### Founding your own kingdom

Instead of taking a throne, you may make one. Hold **3+ settlements** (your colonies, including towns you conquered while unsworn) and have **50+ Prestige**, then use **Form Kingdom** (6 AP) at one of them. It costs 25 Prestige and earns +50 when the realm is proclaimed. The new kingdom is a full kingdom: its capital is that settlement, its land is your settlements and the free (or old liege's) land around them, and it has an army of max(80, 7% of its people), a treasury of max(800, 20% of your gold), a royal council, the faith of its seat, a fleet if it has ports, and the traits Orderly and Mercantile. Seceding from your liege costs −25 reputation with them and −3 karma, and they start out hostile. You rule it exactly as above.

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

### Townsfolk Talk & Heralds

The world talks about itself. What townsfolk say depends on what is going on around them and on who you are (lines live in `data/chatter.json`):

- **Their world**: their realm's wars (and your war with it), an enemy fleet blockading their port, a siege nearby (yours, or one of your holdings), the season and the lean weeks, plague, famine, drought, bandits, pirates, a comet or other world events close by, a revolt, a saga in the region, a rival adventurer who passed through in the last 12 days, a new ruler (30 days), and the heralds' latest proclamations.
- **You**: your earned traits (a Dread Lord is met with terror, the Pious with blessings), your court's reputation (merciful, severe, just, pious, generous), your standing (their king, a foreign king, a pretender, an exile), your House's age and Prestige, and the deeds the gossip has carried to their town.
- **Them**: their occupation and personality — a smith grumbles that the war eats iron, a merchant curses the blockade, a bold villager wants a spear.

You hear it when greeted (hostile folk keep their own greetings), when you ask **"What news?"** (mostly the world's news, never the same line twice), and as an **overheard remark** when you arrive in a town where something is happening (at most once per town every 3 days; Settings → Overheard Town Talk). With the local LLM voice on, the same facts are handed to the model; the written lines stay the default.

**Heralds.** A coronation, a realm falling or rising again, a war declared, a peace made, a saga's end, a revolt or peasant rebellion, a new land named on the charts, or a siege won or broken is proclaimed where it happened. The news travels 8 hexes a day; every town it reaches knows it (townsfolk repeat it, and it is pinned to the tavern notice board) and when it reaches you, you get a dismissible notice. At most one a day, with two quiet days between (the gravest news — a coronation, a fallen realm — always gets through). News of your own doings is talked about but not cried at you. Proclamations are forgotten after 40 days. Settings → Heralds' Proclamations turns the notices off.

**Your deeds spread.** Sacking a town, feeding a starving town from your treasury (the Empty Granaries petition), pardoning a criminal at court, or winning a duel against a rival adventurer starts a rumour where it happened. It spreads from town to town like any rumour and fades over 40–90 days, but it is talk, not a crime: no bounty, no reputation loss, no hostile guards. Townsfolk who have heard it mention it, and **Listen for Gossip** at a tavern repeats it as *Talk of Your Deeds*.

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

- Children can be born each year (25% probability), up to 6. Each is born with a random birth trait: Gifted (+1 all), Strong (+2 STR), Clever (+2 INT), Charming (+2 CHA), and others.
- Designate one as your **heir**. When you die you may still choose any child aged 16+.
- Open **Dynasty → 📖 Upbringing** on a child to raise them.

**Education focus (ages 6–16).** Choose one focus per child. Every 30 days the child grows toward it (a year is 120 days). Without a focus a child picks up a little of every skill (+0.12 a year) and no particular character.

| Focus | Grows per year | Breeds |
|---|---|---|
| ⚔️ Martial | +0.4 strength, +0.5 combat, +0.2 leadership | Brave |
| 💰 Stewardship | +0.25 intelligence, +0.1 luck, +0.5 commerce, +0.25 leadership | Honest, Greedy |
| 🤝 Diplomacy | +0.4 charisma, +0.5 diplomacy, +0.15 leadership | Generous, Honest |
| 📜 Learning | +0.45 intelligence, +0.4 cartography, +0.2 diplomacy, +0.1 commerce | Scholar |
| 🦊 Intrigue | +0.2 intelligence, +0.2 luck, +0.5 stealth, +0.15 diplomacy | Cunning (a little Deceitful) |
| 🙏 Piety | +0.45 faith, +0.1 charisma, +0.25 diplomacy, +0.1 leadership | Pious, Merciful |

Stats cap at 14 and skills at 8 during childhood.

**Tutors.** A tutor multiplies the growth. The full bonus applies when their subject matches the focus; otherwise only 30% of it does.

- *Court tutors* cost gold up front plus a monthly wage, paid every 30 days. An unpaid tutor leaves. The Hedge Tutor teaches all subjects (×1.25, 40g + 6g a month). The Master-at-Arms, Retired Steward, Court Envoy, Court Scholar, Whisperer and House Chaplain each teach one focus (×1.8–1.9, 120–180g + 14–22g a month). Each also passes on some of their own character: the Master-at-Arms breeds bravery, the Whisperer cunning.
- *A companion* travelling with you teaches for free. Their occupation decides the subject: knights and guards teach martial arts, merchants stewardship, scholars and healers learning, priests piety, and so on. Their mood and their friendships in the party scale the bonus, re-checked every month: a content companion teaches at ×1.7 when they have a subject (×1.2 otherwise), a loyal or devoted one better still. A disgruntled or mutinous companion refuses to teach, and stops if their mood sours. Their values rub off: an honourable companion breeds honesty, a greedy one greed. They stop teaching when they leave your party.

**Childhood events.** Every 40 days, each child aged 6–15 has a 45% chance of a dilemma for you to decide. The dilemmas are a bully, a fever, a prodigy moment, a scandal, a duel challenge, a religious calling, the first hunt, a beggar at the gate, the locked library, dice in the stables, the children's court, dreams of the sea, a sibling feud, a wandering mentor, a lie, and a harvest feast. Each choice shapes the child's skills, stats and character. Some choices cost gold and some are risky (⚠️): a fever left to run its course can weaken a child for life, or rarely kill them. Duels and hunts are contests of strength and combat skill. An event left unanswered for 20 days resolves itself with the household's default choice.

**Character.** A child's personality grows from four sources: the focus, the tutor, your choices in their dilemmas, and **your example**. Each of your own earned traits has a 35% chance a year to rub off on each child. Once a tendency is strong enough it shows as a **childhood trait**. A child holds up to three, and of two opposites only the stronger counts. The panel also shows the traits still forming.

**Coming of age (16).** The child's childhood traits become fixed **adult traits**, their tutor is released, and the House chronicle records it. A grown child can then:

- hold a **House office** (Steward, Marshal, Chancellor, Spymaster, Heir), which uses their skills;
- make an **alliance match** into a kingdom's nobility: a 200 gold dowry, for +15 reputation with that kingdom and +4 Prestige;
- make a **royal match** with an unwed prince or princess: 500 gold and 20 Prestige (needs 20 reputation), for +20 reputation and a claim of 15 on that throne;
- be sent as a **ward** to a ruler's court for 120 days. A ward cannot hold an office while away. They return with +1 leadership, +1 diplomacy, +10 reputation with that realm, and often one of the host's traits: a devout ruler teaches piety, a cunning one cunning. Each child can be fostered once.

Married and fostered children stay in the line of succession.

**Succession.** The heir takes over with their own stats and skills, and their adult traits become real earned traits. A regency heir keeps the childhood traits they had. Like any earned trait, these can later be eroded by contrary deeds.

### The House Chronicle and Legacy

**Dynasty → 📜 House Chronicle** tells your House's story one ruler at a time. Each reign shows:

- its years, the ruler's age and cause of death, and their earned traits;
- any title or crown held;
- what happened in it: crowns won (taken or founded), settlements taken, battles won (war hosts, raiders, pirates, monsters and saga beasts), wars fought, quests, titles gained, delves cleared, rival adventurers bested (duels, races, rivals slain), petitions ruled (with the notable rulings), children born, ambition milestones, holding projects built, raids repelled, rebellions crushed, holdings lost and Prestige gained;
- the chronicle's most important entries.

Each ruler also earns an epithet from their deeds ("the Crowned", "the Conqueror", "the Warlike", "the Delver", "the Duellist", "the Judge"), or else from their first trait ("the Brave").

**Legacy score.** Each reign scores:

| Deed | Points |
|---|---|
| Year ruled | 2 |
| Crown won | 150 |
| Ambition fulfilled | 60 |
| Settlement taken | 25 |
| Title gained | 20 |
| Ambition milestone, noble marriage | 10 each |
| Delve cleared | 6 |
| Rival bested, child born | 5 each |
| Earned trait | 4 |
| Rebellion crushed | 6 |
| Raid repelled | 4 |
| Battle won, holding project built | 3 each |
| Quest | 2 |
| Petition ruled | 1 |

The House adds 40 per generation and 1 per point of Prestige.

### Deeds & Records

**Journal → 🏅 Deeds & Records** (also the button under your name on the **Character Sheet**) gathers every record the realm keeps on you into one ledger, grouped by system. Two columns: **House**, the lifetime total of your line, and **Reign**, the current ruler's share since they took the mantle. Present-tense facts (holdings ruled, claims held, your hunter rank, guild rank, trading posts, company capital, companions travelling with you) show as "now". A section with nothing in it yet is folded into a "No record yet" line.

| Section | Records |
|---|---|
| ⚔️ Arms & House | battles won, quests, titles, settlements taken, noble marriages, ambition milestones |
| 👑 The Throne | crowns won, claims held, succession crises and civil wars underway, reigning, throne chronicle entries |
| 🏛️ The Royal Court | vassal lords and edicts in force; edicts proclaimed, royal feasts, grants and favours, plots uncovered, revolts (crushed and conceded), lords broken, crown monopoly revenue, grain given in the famine dole, crowns lost or set down, days ruled under them. These tallies include every crown your House has worn and lost, so they don't reset when a crown goes |
| 🏯 Holdings Besieged | under siege now; sieges endured, relieved, held, saved by terms, bought off, lifted by peace, fallen |
| 🏰 Holdings | holdings ruled, projects built, raids repelled and suffered, rebellions and rebellions crushed, holdings lost, governors who betrayed you |
| ⚖️ Petitions & Court | petitions ruled and ignored |
| 🛡️ Sieges | towns besieged, taken, sacked, terms accepted, sieges lifted and broken, relief armies beaten |
| 📜 Sagas | sagas begun, joined, won and ended; saga beasts slain and their bounty gold |
| 🎯 Bounty Hunting | hunter rank, bounties completed, outlaws turned in or recruited, captures botched, saga beasts on notice |
| 🕳️ Delves | delves entered, chambers explored, delves cleared, deepest chamber, retreats, collapses |
| 🗡️ Rival Adventurers | duels and races won and lost, rivals slain and sabotaged, partnerships, hires |
| 🤝 Companions | travelling with you, devoted, fallen, deserted, betrayed you |
| 🌑 The Underworld | guild rank, crimes, times caught, gold from crime |
| 🏦 Trading Company | posts, capital, contracts fulfilled and failed, posts robbed, convoys lost |
| 🧭 Discoveries | lands found and named, exotic hauls, charts sold, colonies, naval contests, lands rivals found first |
| ⛵ Voyages | voyages completed, days at sea, events at sea, longest voyage |
| 🩹 Wounds & Sickness | wounds, diseases, recoveries, festered wounds, scars, treatments |
| 📯 The Heralds | news proclaimed in the world and proclamations you heard, with the last five that reached you (including any the heralds' daily limit kept quiet) |
| 🌿 Living off the Land | foraging trips and hunts, with your forager's and hunter's craft rank |

Below the sections, the ledger lists your **achievements** by tier, each with the day it was won, and the name of every quest you completed.

**A lost crown's record.** When you abdicate, or your realm falls, the reign's royal-court record goes into the House's crown ledger: the realm, the days ruled, how the reign ended, the edicts in force, the lords and every court tally. A line is also added to the House chronicle. In the House Chronicle, each ruler's card shows the court they kept (edicts, feasts, plots uncovered, revolts crushed and conceded, lords broken, monopoly revenue, dole grain) and any crown they lost. The ledger is saved with the House.

A reign that began in a save from before the ledger existed is counted from the House's beginning. The voyage record is saved with your character.

**The line ends.** If you die with no heir, or let the dynasty end rather than install a regency, the epitaph screen shows your House's sigil and motto, its generations, years and crowns, every reign, and its rank:

| Score | Rank |
|---|---|
| Under 150 | A Forgotten Line |
| 150+ | A Minor House |
| 400+ | A Respected House |
| 900+ | A Great House |
| 1,800+ | A Legendary Dynasty |

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

**Uncharted lands.** A colony founded on or within 3 hexes of an island, cove or valley you found claims it. You alone gather its exotic goods, and more of them. Realms that know of the place may contest the claim with their navies (see [Uncharted Lands](#uncharted-lands)).

### Colonization Policies

| Policy | Expansion | Indigenous Relations | Loyalty | Production |
|--------|-----------|---------------------|---------|-----------|
| Manifest Destiny | 1.5× | Very Negative | +5% | +10% |
| Coexistence | 0.8× | Very Positive | +15% | No bonus |
| Exploitation | 1.0× | Very Negative | −10% | +30% |
| Missionary | 1.0× | Slightly Positive | +10% | +5% |

**Missionary work.** A Missionary colony befriends tribes within 4 hexes (+0.05 relation a day) and converts them to its faith. If it is your colony and you have founded a religion, it spreads *your* faith: every settlement within 4 hexes gains a share of followers each day, and converted tribesfolk join your faith (2% of a tribe's people a day). The mother kingdom gains cultural influence and piety (+0.01 a day per colony, at most +0.05). The colony panel shows how far its missionaries reach. Religious kingdoms send Missionary colonies of their own.

### Developing Your Holdings

Your **holdings** are the settlements you rule and tax: colonies you founded and towns you conquered that are still yours. Open **🏰 Manage Holding** from the action menu at one of them (or from the colony panel). The panel shows the town's development slots, the projects being built, its governor and garrison, and a summary of its numbers: weekly tax (and how much the governor skims), happiness and the target it is drifting toward, loyalty, unrest, defence against the rebels it could raise, garrison strength and upkeep, days of food in store and yearly growth.

**Projects.** A holding has a few development slots, and more as it grows:

| Tier | Population | Slots |
|------|-----------|-------|
| Hamlet | under 150 | 2 |
| Village | 150+ | 3 |
| Town | 600+ | 4 |
| City | 2,000+ | 5 |
| Great City | 5,000+ | 6 |

A project costs gold, materials and days. Materials come out of your packs. Anything you lack is bought on the spot at 1.5× its price (wood and stone 12g, iron 30g, tools 52g). Stone and timber near the town shorten the work. A good steward speeds it up (+6% per point of stewardship). You can abandon a project under construction for half its gold back. The panel shows each project's effect before you build it, with the gold it would add to the weekly tax and the change in defence.

| Project | Cost | Days | Effect |
|---------|------|------|--------|
| 🚧 Palisade | 150g, 20 wood | 6 | +25% defence, 20% fewer bandit raids, calms unrest |
| 🏰 Stone Walls (replaces the Palisade, village+) | 600g, 40 stone, 4 tools | 15 | +60% defence, 45% fewer raids, calms unrest more |
| 🏪 Market Square | 300g, 10 wood, 15 stone | 8 | +12% tax, +4% on what you sell there, +2 happiness, +1% growth a year |
| 🌾 Granary | 200g, 25 wood | 6 | +6 days of food in store (the lean season), +1% growth, +1 happiness |
| 🕯️ Shrine | 120g, 8 stone | 4 | +3 happiness, spreads your faith there (0.4% of the unbelievers a day), calms unrest |
| ⛪ Temple (replaces the Shrine, village+) | 550g, 35 stone, 10 wood | 12 | +6 happiness, spreads your faith (1% a day), calms unrest more |
| ⚔️ Barracks | 350g, 20 wood, 8 iron | 9 | +10 militia defence, +50% recruits a day and 10% cheaper recruits here, garrison upkeep −25% |
| ⚓ Harbour (beside the water only) | 450g, 35 wood, 10 stone | 12 | +8% tax, 8% better port-market prices for you, free repairs (+5% a day) for your ships docked there, +2 days of food, +1.5% growth |
| 🗼 Watchtower | 180g, 10 wood, 10 stone | 5 | 40% fewer raids, your underworld heat in the town's realm (for an independent town, the nearest realm) cools 0.5 a day faster, +5% defence |
| 🔨 Workshop Quarter (village+) | 400g, 20 wood, 10 iron, 4 tools | 10 | +20% goods produced, +6% tax |
| 🍺 Tavern and Inn | 250g, 20 wood | 7 | +4 happiness, +1.5% growth, +10% daily chance of settlers arriving at a young colony, +3% tax |
| 🏛️ Moot Hall (village+) | 320g, 15 stone, 10 wood | 8 | petitioners from the town wait 4 days longer, +2 happiness, calms unrest most |

A **governor** also keeps petitioners in hand while you are away: petitions from a governed town wait 1 extra day per 3 points of the governor's Stewardship (up to 3).

Happiness from projects raises the target the town drifts toward at each tax collection. Growth adds to the tax policy's yearly growth, and in a kingdom's colony it also speeds the daily growth. Walls also stand if the town is ever taken from you, so retaking it will be harder.

**Governor.** Appoint a governor from your travelling companions (they leave your party until relieved, and cannot be invited back while in office; a companion's personal quest waits for them), your spouse (who also leaves your party if travelling with you) or a child aged 16 or over, or a steward for hire (100g, then 3–6g a day; three are on offer each month). Each has **Stewardship**, **Martial** and **Intrigue** from 0 to 10:

- **Stewardship:** +3% tax and +0.3% growth a year per point, and faster building.
- **Martial:** +4% defence per point, and calms unrest.
- **Intrigue:** calms unrest and wards off raids (+2% per point), but makes a disloyal governor skim more.

A governor's **loyalty** settles toward a base (family 80, a companion's approval of you, a steward 55), plus up to +10 from your renown and ±5 from the town's mood, minus 2 per point of intrigue (ambition) and 15 while their wages go unpaid. Below 70 loyalty a governor **skims** the taxes: up to half of them, more the craftier they are. Below 20 loyalty they may **betray you**, fleeing with up to 10% of your gold (at most 300g) and leaving the town in uproar (+40 unrest). You are warned when a governor grows restless.

**Neglect.** A holding with no governor drifts while you are more than 6 hexes away. Each day it loses 0.25 happiness (down to 20) and 0.15 loyalty, and its unrest grows.

**Garrison.** At the holding you can station soldiers from your army there, and march them out again. Hired mercenaries and warships can't be stationed. The garrison adds its strength to the town's defence against kingdom war hosts, bandits and rebels. It also calms unrest (fully once it reaches 2% of the population, at least 20 strength), and it is paid from your purse every day at the troops' normal upkeep. If you can't pay, a tenth of it deserts. In a siege (see [Holdings Under Siege](#holdings-under-siege)) the garrison's losses fall on the stationed troops. If the town is lost, its garrison is lost with it.

**Defence** = (the colony's own guard, or 10) + 1% of the population + garrison strength + militia, × (1 + walls, watchtower and governor bonuses).

**Unrest and rebellion.** Unrest (0–100) eases by 0.25 a day on its own and is raised by:
- unhappiness below 40, up to +1.5 a day
- loyalty below 30, up to +0.8 a day
- high taxes (+0.15 a day, very high +0.35)
- neglect (+0.4 a day)

It is calmed by order from projects and the governor, by your troops, and by your presence (−0.5 a day while you are within a hex). From 60 you are warned. From 75, a holding whose garrison couldn't beat its rebels may rise in revolt (rebels number 10 + 4% of the population). At 100 it rises for certain. A strong enough garrison puts the riots down instead, losing some troops.

A **rebellion** stops all taxes and building there. A garrison that grows strong enough crushes it on its own. Otherwise you have **15 days**:
- **Crush the rebels** with your army at the holding (a battle).
- **Buy them off** for half a gold coin per inhabitant (at least 100g) and 5 renown.

If the rebels still hold the town at the deadline, it becomes a free town and is no longer yours.

**Bandit raids.** Raider bands within 2 hexes of a holding may fall on it (about 6% a day per band, less with walls, a watchtower and a crafty governor, and at most once a week). If the town's defence beats the band, the band is destroyed. Otherwise the raiders burn 30% of its stored food (and 15% of the market's stores, which damages any works there), kill 3% of its people, cost 6 happiness and 8 unrest, and set back construction by 2 days.

A holding you lose — to rebels or a war host — keeps only its walls. Its harbour, markets, workshops and other works stop serving you until you take it back.

Projects, governors, garrisons, unrest and rebellions are all saved with the game.

---

## Patronage & Great Works

Gold piles up; Patronage is where it goes to last. You can keep **clients** (artists, scholars, architects, physicians and chroniclers) who make works in your name, and raise **Great Works**: cathedrals, libraries and wonders that stand on the map for good and change how other parts of the game play. Open it from **Patronage & Great Works** in a town's action menu (the 🎨 social action), or from the Counsel.

### Clients

Every **town and capital** keeps a **salon** of three people looking for a patron. The salon changes each month, and the same town offers the same faces to anyone in the same month. Each candidate has:

| | |
|---|---|
| **Profession** | 🎨 Artist (paintings, sculptures) · 📚 Scholar (treatises) · 📐 Architect (oversees a Great Work) · ⚕️ Physician (medical texts) · 📜 Chronicler (chronicles of your House) |
| **Skill** (1–10) | How fast they work and how good the work is. Capitals draw better talent. |
| **Temperament** | Diligent (fast, frets when idle) · Mercurial (slow, touched by genius) · Proud (costly, loyal to a great House) · Devoted (cheap and faithful) · Restless (quick, with a wandering eye) |
| **Ambition** | Fame (wants works donated where people see them) · Wealth (wants a fat stipend, easy to poach) · Mastery (wants commissions, gains skill with each work) · Glory (wants to serve a House of 150+ Prestige) |
| **Stipend** | Gold a week. Hiring costs two weeks up front. |

You can keep **4 clients** (5 while you hold a royal office). Stipends are paid every 7 days. A client who goes **unpaid three weeks** leaves, and so does one whose **contentment** falls near zero. Contentment rises while they work and are paid, falls while they sit **idle** (after a two-week grace), and moves each month with their ambition. You can **raise a stipend** by a fifth to cheer someone up.

**Commissions.** Set an idle client to work. The materials come out of your packs, and anything missing is bought for you at a markup. Each work comes out **modest**, **fine** or a **masterpiece**: skill, temperament and contentment decide which, and a masterpiece counts for about 1.6×.

| Work | Takes | Materials | Effect |
|------|-------|-----------|--------|
| 🖼️ Painting | ~35 days | 2 dyes | +4 Prestige; goes to your **gallery** |
| 🗿 Sculpture | ~55 days | 8 stone | +6 Prestige; goes to your gallery |
| 📖 Treatise | ~40 days | 2 parchment | 6 days of progress on your **current research**. Days it can't use are banked and fed into later research one day at a time. |
| ⚕️ Medical text | ~45 days | 4 herbs, 1 parchment | Sickness is less likely to worsen or kill (×0.94 per text, down to ×0.6), and wounds mend faster (+0.1 a day per text, up to +0.5) |
| 📜 Chronicle | ~60 days | 3 parchment | +8 Prestige, an entry in the House chronicle, and +4 to the reign's **Legacy** score |

**The gallery.** Keep paintings and sculptures, or **donate** one to the town you stand in. A town you rule grows happier: its happiness target rises by 1.5 per point of art, up to +8. A town elsewhere raises your standing with its realm by 3 per point. Each donation also gives +1 renown, and a client who seeks fame is glad of it.

**Rival Houses poach.** Every couple of weeks a rival House (see *The House*) may court one of your clients. The chance is higher for skilled, restless or wealth-seeking clients, for unhappy ones, and when the feud with that House runs hot. You have **6 days** to **match the offer** (about ten weeks' stipend; the client stays on 25% more pay and is happier for it) or **let them go**. If you don't answer, the client decides alone, and a contented client usually stays. Every client lost to a rival inflames the feud.

### Great Works

A Great Work rises at a settlement **you rule** (a holding) or one where **you own a house** (your seat). You can raise up to two at once, one per town, and each kind only once.

| Work | Needs | Stages | Grants (while the town is yours) |
|------|-------|--------|----------------------------------|
| ⛪ Grand Cathedral | town | 3 | Your faith converts +25% faster; town happiness +6 |
| 🏛️ The Great Library *(unique)* | town | 3 | Research +20% faster; happiness +2 |
| 🎓 University | town | 2 | The heirs of your House learn 35% faster; happiness +2 |
| 🔭 The Royal Observatory *(unique)* | village | 2 | You see 1 hex further everywhere |
| 🏟️ Hippodrome | town | 2 | +4 renown from every festival you host; happiness +5 |
| 🌉 Grand Bridge | a river | 2 | Fording rivers costs half the effort, everywhere |
| 🗽 The Colossus *(unique)* | a harbour | 3 | +6 House Prestige every month; happiness +3 |

Finishing one also gives a large one-time Prestige award (40–100), renown, and a line in your House chronicle. It also scores **+40** on the reign's Legacy.

**Building.** Each stage wants **goods** (stone, timber, iron, glass, parchment…) and **gold** delivered first. Goods in your packs can only be handed over **on site**. From anywhere you can have the rest **bought for you**, at a markup that is steeper when you're away. Once a stage is supplied, the masons work it for a set number of days, and their **wages** (6–12 gold a day) come out of your purse each day. Work goes faster in bigger towns and with an **architect** in charge (+5% per point of skill). It **slows by half** when the town's realm, or you, are at war. It **stops** in:

- **winter**, for outdoor stages (foundations, walls, statues; interiors carry on)
- a **famine** in the region
- a **siege** of the town
- when the purse **can't pay** the day's wages
- when the town is **no longer yours**

A finished work stands on the map with a gold ring. Its gifts last only while you hold the town, but they come back if you retake it.

### The race for wonders

Kingdoms build too. From about day 90 a realm with a full treasury may start a wonder at its capital and pay for it day by day. Winter and war slow it, and it stalls when the treasury runs dry. A finished wonder steadies the realm (its stability target rises). **Unique** works (the Great Library, the Royal Observatory, the Colossus) exist once in the world: **the first to finish claims it**. If a kingdom finishes yours first, your half-built works are sold off for half of what you spent. If you finish first, the kingdoms racing you give up. The heralds proclaim every wonder begun and finished, and townsfolk talk about them. The **Wonders** tab of the panel and the Counsel show how far each rival has got.

**The Counsel** warns of rival offers, stalled works and races you might lose, and reminds you of idle clients and stages waiting for supplies. **Achievements:** Patron of the Arts, A Masterpiece, Great Builder, Wonder of the World, A Golden Age. **Deeds & Records** has a Patronage section.

---

## 21. Tavern & Intelligence

Visit taverns in cities and settlements to gather intelligence, hire informants, and more.

### Tavern Actions

| Action | Cost | Effect |
|--------|------|--------|
| Buy Drinks | 5g | 1–3 random rumors (55% accuracy); when something is happening in the region (war, blockade, siege, plague, a saga, a rival, a new ruler, a revolt, a proclamation) most are *Talk of the Region*, and an inaccurate one is a distorted telling |
| Talk to Merchants | 10g | Prices for 3–5 goods at 2–4 nearby settlements (85% accuracy) |
| Ask about Characters | 50g | Intel on 2–3 nearest rulers (70% accuracy) |
| Ask about Military | 50g | War reports, army estimates (cities only, 70% accuracy) |
| Ask about Sacred Places | 50g | Discover 1–3 holy sites (70% accuracy) |
| Hire Informant | 200g + 10g/day | Permanent source in this city (95% accuracy) |
| Check Notice Board | Free | Kingdom decrees, settlement stats, bounties, the heralds' proclamations, talk of sagas and of [uncharted lands](#uncharted-lands) |
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

The game features **68 quest templates** (plus artifact quests) across 5 categories with 4 difficulty tiers (Easy, Medium, Hard, Legendary). 26 of them send you into the newer systems (see [Quests in the Newer Systems](#quests-in-the-newer-systems)).

### The Quest Board

Open the **Quest Journal** to see up to **5 offered quests** and press **Accept** to take one on (at most 5 active at once). Accepting refills the board. The board is also refreshed **every week**. A posting stays up for **30 days** (the journal shows "Posted until day N"), then comes down and isn't posted again for another 30 days. Any empty places are refilled from the catalogue. Artifact quests stay posted while you hold the fragment.

**Favours for townsfolk.** A task you accept from someone in conversation becomes a quest, and completing it pays its reward. A "reputation" task also earns **+8 reputation** with the realm you were in when you accepted it, and a "favour" task earns +3. The person who asked remembers it: the next time you speak with them, they thank you and like you more (+15 disposition). Offers are drawn from the whole catalogue, and harder tiers unlock as you prove yourself:

| Tier | Unlocks after |
|------|---------------|
| Easy | Always |
| Medium | 2 completed quests or 25 renown |
| Hard | 5 completed quests or 100 renown |
| Legendary | 10 completed quests or 300 renown |

Artifact quests appear as soon as you find a fragment of that artifact. Progress counts everything you've done since the start of the game — battles won, ruins explored, treasure dug up, roads built, taverns visited, trade revenue and so on — so a quest may complete the moment you accept it. Heresy Hunter counts heresies you suppress with Denounce Heresy; Alliance Broker counts alliances you broker from the Wars of the Realm panel.

### Quests in the Newer Systems

These quests are offered **only when their system is within your reach** — a sea quest only if you own a ship or stand in a port, a court quest only if you hold a holding (or have petitioners waiting), a siege-relief quest only while one of your holdings is besieged or your trading company has a siege-relief contract on offer, and so on. An offer whose system slips out of reach (the ship sold, the siege over) leaves the board at the end of the day. Unlike the older quests they count only what you do **after accepting**. Delivery objectives ask you to carry goods; they are taken from your packs when the quest completes.

| Quest | Difficulty | Offered when | Objective | Reward |
|-------|-----------|--------------|-----------|--------|
| A Physician's Herbs | Easy | Always | Forage twice, bring 6 herbs | 150g, 5 renown, 2 karma |
| Furs for the Winter | Easy | Always | Hunt 3 times, bring 4 pelts | 220g, 5 renown |
| Satisfaction Demanded | Easy | Rival adventurers are abroad | Win a duel against a rival | 400g, 10 renown |
| Scales of Justice | Easy | You hold court | Rule on a petition with justice | 400g, 10 renown |
| Tomb of the Old Kings | Medium | Always | Clear a Buried Tomb delve | 900g, 20 renown |
| The Deep Seam | Medium | Always | Clear an Abandoned Mine delve | 800g, 15 renown |
| The Blind Dark | Medium | Always | Clear a Deep Cave delve | 700g, 15 renown |
| Bread for the Besieged | Medium | A holding of yours is besieged, or a siege-relief contract is on offer | Get supplies into a besieged holding, or fulfil a siege-relief contract | 900g, 25 renown, 3 karma |
| Escort the Convoys | Medium | You run a trading company | Bring 3 company convoys in | 1,000g, 15 renown |
| A Name for Reliability | Medium | You run a trading company | Fulfil 2 supply contracts | 1,500g, 20 renown |
| The Rumoured Isle | Medium | You own a ship or stand in a port | Discover a land a rumour or a chart spoke of | 1,200g, 25 renown |
| A Seasoned Crew | Medium | Ship or port | Complete 3 voyages | 900g, 15 renown |
| The Merciful Hand | Medium | You hold court | Rule on 2 petitions with mercy | 600g, 15 renown, 5 karma |
| The Iron Law | Medium | You hold court | Rule on 2 petitions with severity | 700g, 20 renown |
| Walls and Works | Medium | You rule a holding | Complete 2 holding projects | 1,000g, 20 renown |
| Raiders at the Gate | Medium | You rule a holding | Repel a raid on a holding | 900g, 20 renown |
| By Royal Decree | Medium | You rule a realm | Pass a royal edict | 1,500g, 25 renown |
| Honour Among Thieves | Medium | You've met the Thieves' Guild | Commit 3 crimes | 800g, 10 renown |
| The Drowned Halls | Hard | Always | Clear a Sunken Ruins delve | 1,500g, 30 renown |
| Name the New Land | Hard | Ship or port | Discover an uncharted land and name it | 2,000g, 35 renown |
| Run the Blockade | Hard | An enemy fleet blockades a realm | Sell goods on the black market in a blockaded realm | 1,500g, 20 renown |
| Slay the Beast of the Saga | Hard | A saga beast roams | Slay a saga beast | 2,500g, 40 renown |
| Take the Town | Hard | You lead 3+ units | Take a town by siege | 3,000g, 45 renown |
| No Relief for Them | Hard | You are besieging a town | Beat a relief army | 2,000g, 35 renown |
| The Kingmaker's Wager | Hard | A succession crisis is underway | Back the winning claimant | 2,500g, 40 renown |
| A Friend Indeed | Hard | Companions travel with you | Win a companion's devotion | 1,200g, 25 renown |

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

The game tracks **96 achievements** across multiple categories with Bronze, Silver, Gold and Legendary tiers. They are checked at the end of every day; each one reads something the game really records (a counter in Deeds & Records, a system's live state, or an event counter), so every one can be earned. **Journal → Deeds & Records** lists the achievements you have won by tier, each with the day it was won, and your overall progress.

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

### Achievements of the Newer Systems

| Achievement | Tier | Requirement |
|-------------|------|-------------|
| Into the Dark | Bronze | Finish your first delve |
| Delve Master | Silver | Clear 10 delves to the bottom |
| Six Chambers Down | Gold | Reach the sixth chamber of a delve |
| Every Dark Place | Gold | Clear a delve of every kind: sunken ruins, tomb, ruins, mine and cave |
| Duelist | Bronze | Best a rival adventurer in a duel |
| Master Duelist | Silver | Win 10 duels against rival adventurers |
| Blood Feud | Silver | Slay a rival adventurer |
| A Friend for Life | Bronze | Win a companion's devotion |
| Band of Brothers | Gold | Win the devotion of 3 companions |
| Magistrate | Bronze | Rule on 10 petitions |
| Wisdom of Solomon | Silver | Rule on 50 petitions |
| Lord of the Manor | Bronze | Rule a holding |
| Improver of Lands | Silver | Complete 10 projects in your holdings |
| Iron Fist | Silver | Crush a rebellion in one of your holdings |
| Unbroken Walls | Silver | See a holding through an enemy siege: relieved or held |
| The Gates Give Way | Silver | Take a town by siege |
| Breaker of Cities | Gold | Take 5 towns by siege |
| No Relief Coming | Silver | Beat an army marching to relieve your siege |
| The Stuff of Sagas | Silver | Bring a saga you joined to a triumphant end |
| Saga of Ages | **Legendary** | Win 3 sagas |
| Wyrmslayer | **Legendary** | Slay the wyrm of "The Wyrm Wakes" saga |
| Monster Hunter | Silver | Claim the bounty on a saga beast cried on the notice boards |
| A Claim to the Throne | Bronze | Hold a claim on a throne |
| Kingmaker | Gold | Back the claimant who wins a succession crisis |
| Uneasy Lies the Head | Gold | Win a crown |
| The Full Council | Gold | Fill all five seats of your royal council |
| Lawgiver | Silver | Pass 5 royal edicts |
| Long Reign | **Legendary** | Rule a realm for 10 years |
| One of the Guild | Bronze | Join the Thieves' Guild |
| Prince of Thieves | Gold | Rise to the top rank of the Thieves' Guild |
| Chartered Company | Bronze | Found a trading company |
| Merchant Prince of the Seas | **Legendary** | Run 5 trading posts and bring 10 company convoys in by ship |
| Hostile Takeover | Gold | Buy out a rival merchant house |
| Land Ho! | Bronze | Discover an uncharted land |
| Cartographer of the Unknown | Gold | Name 5 lands you discovered |
| Sea Legs | Bronze | Complete a voyage |
| Old Salt | Silver | Spend 100 days at sea |
| Admiral | Silver | Command a fleet of 5 ships |
| Survived the Black Death | Gold | Catch the plague and live |
| Master Forager | Gold | Reach the rank of Master Forager |
| Master of the Hunt | Gold | Reach the rank of Master of the Hunt |
| A Person of Character | Silver | Earn 5 character traits |
| Raised Right | Silver | Raise a child of your House to come of age |
| Blood Royal | Gold | Marry a child of your House into a royal line |
| The Line Endures | Silver | Pass the House to an heir |
| Patron of the Arts | Bronze | Take a client into your service |
| A Masterpiece | Silver | Commission a masterpiece |
| Great Builder | Gold | Complete a Great Work |
| Wonder of the World | Legendary | Be first in the world to finish a unique Great Work |
| A Golden Age | Legendary | Raise 3 Great Works and commission 12 works |

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

## Sagas

Beyond single events, the world tells **sagas**: storylines in 3–5 chapters that unfold over two to four months whether or not you take part. Each one is staged on the game's own systems. Its chapters start real timed events, plagues and famines, put monsters and fleets on the map, open delve sites, raise heresies and succession crises, bring petitioners to your court and post quests. Each saga ends in one of several ways, and every ending leaves the world changed.

**When.** The first saga begins somewhere between day 60 and day 120 of a new game. After that a new one starts every 45–90 days, and at most two run at once. Sagas are chosen to fit the world: Sea Reavers needs a coast, The Wyrm Wakes needs mountains or hills, and the faith sagas need a realm with a faith. The same saga does not come round again for about five years.

**Hearing of them.** You only follow sagas you have heard about:
- **Tavern notice boards** (free at any tavern) carry talk of sagas within about 28 hexes or in that town's kingdom.
- **Being near.** If you are within 10 hexes when a chapter turns, you see it for yourself.
- **Public chapters** (a wyrm burning villages, a plague, a reaver fleet, a pretender's crisis) are news everywhere.
- **Petitioners** who come to your court about a saga, and a saga **quest** on your quest board.
- Every ending is news. You always hear how a saga ended, even if you never heard it begin.

**The Sagas journal** (Journal → 📜 Sagas) lists every saga you know of: the chapters you saw and their dates, what you have heard, where its monster was last seen, its delve site, and **Your Part**, the actions the current chapter offers. An action may need you to be near a place (the town, the capital, the lair, the monster), or need gold, Prestige, renown, soldiers or goods. Chapters that passed before you heard of the saga stay hidden.

**Taking part.** You join a saga by taking one of its actions, ruling its petition, accepting its quest, or killing its monster in battle. Once you have taken part, its ending pays out: renown, House Prestige, gold, kingdom reputation, trait deeds, items, and an entry in your House chronicle. If your side lost, it scars you instead. A saga you ignored still ends; the world decides without you, and you get nothing from it. A successful ending completes the saga's quest, which pays its own reward. Any other ending withdraws the quest.

**The end-of-day report** tells you when a saga you know of turns a chapter, when word of a saga first reaches you, and when a saga raid strikes one of your holdings.

### The sagas

| Saga | Where | Chapters | Your part | How it can end |
|------|-------|----------|-----------|----------------|
| 🐉 **The Wyrm Wakes** | Peaks near a town | Tremors → Vanishing Herds (livestock gone, meat dear, the lair appears as a delve site) → Fire on the Roofs (a wyrm of strength 110–150 roams and burns villages; trade and stability fall) → The Hunt (a rival adventurer goes after it) | Scout the cleft; leave offerings (200g); parley with the wyrm (500g, beside it); slay it in battle; delve its lair while it hunts | **Wyrmslayer** (3 dragon scales, +40 renown, +25 Prestige); **The Wyrm's Bargain** (it sleeps on your gold); **The Stolen Hoard** (gold and a scale, but the town burns); a rival is hailed Wyrmslayer and loots the lair; or the wyrm's shadow lies on the realm for a season |
| 😷 **The Grey Cough** | A kingdom's capital | The Censer-Bearers (a cult heresy rises) → Plague (a real plague event that you can catch, and a Sealed Hospice delve site) → the Scholar's Vigil, or the cough spreads to the neighbouring realm | Consult the physicians (60g); fund a scholar (400g); break the censer processions (5+ soldiers); delve the Sealed Hospice | **The Cure** (the plague ends, you are cured, +30 renown, +10 karma); or the plague **burns out**, taking 6% of the realm's people |
| 👑 **The Lost Heir** | A kingdom with a ruler | A Signet Ring → Lords in the Night → The Pretender (a real succession crisis; back a claimant at court as usual) | Seek out the claimant; warn the ruler; expose the fraud (150g, at the capital, after meeting them); offer your hand (300g, 20 Prestige: a claim on the throne and support for the pretender); raise your banner for them (8+ soldiers) | **Long Live the Heir** (the pretender is crowned, and a spouse or banner-man is richly rewarded); **The Pretender Falls** (shame for their backers); **The Fraud Unmasked** (the crisis ends, +300g, reputation) |
| ❄️ **The Long Winter** | A kingdom | Early Frost → The Hungry Months (a long famine, and hoarders driving food prices up) → Bread Riots | Give 40 food to the poor; break open the hoarders' barns (3+ soldiers; the underworld counts it as theft); buy into the hoarders' ring (200g); at court, open your stores | **The Thaw** (you fed them: renown, Prestige, reputation); **A Fat Spring** (650g for the profiteer, but karma and reputation are lost); **A Bitter Spring** (riots and graves) |
| 🏴‍☠️ **Sea Reavers** | A coastal town | Black Sails (more pirates, less sea trade) → The Reaver Fleet (a flagship and galleys raid the coast; prices rise) → The Battle of the Headland (the royal fleet sails out) | Sink the flagship; pay the reavers to go (500g); fund the royal fleet (300g, which raises the crown's chances) | **The Flagship Burns** (you sank it); **Paid to Go** (they raid other seas); **The Crown's Victory**; **The Reaver Coast** (the reavers hold the sea-lanes for months) |
| ⛪ **The Sundering Faith** | A kingdom with a faith | The Barefoot Preacher (a heresy) → Schism (stability and piety fall, heresy spreads) → Holy Strife (riots; the neighbour backs the bishops) | Hear the preacher; champion the reformers or stand with the bishops (one or the other); call a council of reconciliation (300g, 40 renown, at the capital); force a truce in the strife (250g, 8+ soldiers) | **The Council of Reconciliation**; **The Reformation**; **The Bonfire**. The side you chose shares the victory or the shame |
| ⚔️ **The Iron Company** | A kingdom | Wages in Arrears → The Company Goes Rogue (a company of strength 80–110 plunders the land) → The Sack (a town is sacked and the treasury pays a ransom) | Pay their arrears (400g) or buy their contract (600g, beside them); beat them in battle | **The Company Broken**; **A New Paymaster** (you); **The King's Justice**; or they cross into the neighbouring realm |
| ☄️ **The Comet** | Everywhere, with a seer in one realm | The Forked Star → The Prophecy (a star cult, and a Starfall Crater delve site) → The Red Star (panic, prices rise) | Pay an astrologer to chart it (50g); debate the seer (after charting); delve the crater | **The Star-Iron** (an artifact and gems); **The Seer Confounded**; the cult rises; or the star simply fades |

### Bounties on saga beasts

The wyrm, the reaver flagship and her galleys, and the Iron Company carry a price on their heads, paid by the realm they threaten. Kill one in your own battle and, at the end of the day, you get:

| Beast | Bounty | Renown | Reputation | Prestige | Taken from it |
|-------|--------|--------|------------|----------|---------------|
| 🐉 The Wyrm | 600g | +25 | +15 | +5 | 1–2 dragon scales, 2–5 gems; 30% an ancient artifact |
| ☠️ The reaver flagship | 400g | +18 | +12 | +3 | an enchanted weapon, 2–4 luxuries, 3–6 rum; 35% a treasure map |
| 🏴‍☠️ A reaver sloop or galley | 60–90g | +3–4 | +3 | — | 2–4 rum |
| ⚔️ The Iron Company | 475g | +20 | +15 | +3 | 4–8 weapons, 1–3 leather armour; 30% an enchanted weapon |

The gold comes out of the realm's treasury. A realm that can't pay in full still scrapes together half, and a realm that has fallen leaves half, passed round the villages. Goods that don't fit in your packs are sold on the spot. The kill counts as valour and is written in the House chronicle. The bounty comes on top of whatever the saga's ending pays (Wyrmslayer's three scales, and so on). A beast killed by anyone else pays nothing.

While a wyrm, flagship or company roams, every **notice board** within 28 hexes posts it as a legendary bounty: where it was last seen, the price, and the realm that pays. Take the notice and the board tracks the beast for up to 120 days. When you kill it, you earn a **hunter's fee** on top of the realm's bounty: 25% more, plus your hunter rank's pay bonus. It counts as a bounty completed and toward your hunter rank. If the beast leaves the story (flies off, sails away, crosses into another realm), the notice lapses. Rival bounty hunters leave saga beasts to you.

Saga monsters and fleets are named world units. A kingdom patrol cannot bring down the wyrm or the Iron Company, but royal war fleets do hunt reavers; if one sinks the flagship, the crown gets the credit. Everything a saga changes is saved with your game: its events, sites, crises and heresies with the world, and the saga itself with you. Its monsters return to the map when you load.

---

## Outlaw Lairs

Random bandit bands come and go, but an **outlaw lair** stays. Lairs are strongholds that take root in country nobody polices well, grow while nobody deals with them, and send out raiding parties that are real units on the map. Five kinds exist:

| Lair | Where it forms | Its raiders | Can you bargain? |
|------|----------------|-------------|------------------|
| 🏕️ **Bandit Camp** | Woods, plains, grassland and hills near a road | Cutthroats who rob caravans and burn villages | Tribute or partnership |
| ⚓ **Smugglers' Den** | Beaches, swamps, islands and other ground beside water | Runners who rob caravans; more coin, less burning | Tribute or partnership |
| 🏚️ **Deserters' Fort** | Hills, highlands and plains near a road, only in a realm at war | A free company: the strongest raiders, and the lair grows faster while the war lasts | Tribute or partnership |
| 🕯️ **Cultist Grotto** | Hills, mountains, swamps and deep forest | The Hooded, who carry off pilgrims: each raid also lowers the realm's faith unity | Tribute only |
| 🐺 **Beast Den** | Wild forest, mountains and tundra **away** from roads | A pack (a beast unit) that takes herds and people but no coin | No |

**Where and when.** Two lairs exist from the first day. Every two weeks after day 12 another may form, up to six at once and two per realm. A lair forms 3–8 hexes from the nearest town, on the same land as that town, never on a settlement, ruin or building, and at least 9 hexes from another lair. The likeliest places are realms with **low stability**, unclaimed wilderness, and land near a road. A **lawful lord** (the NPC lord personality) keeps them away. Where lairs form is decided by the world's seed, not by chance rolls.

**Each lair has** a name, a **chief** with a name and a trait, a **strength** (fighting men), **notoriety**, and a **hoard**:
- *Cruel* chiefs burn more on every raid. *Cunning* ones are hard to scout and harder to storm. *Greedy* ones raid for more coin and charge more tribute. *Honourable* ones do less harm, charge less, and keep their bargains. *Savage* is for beasts.
- **Strength** grows every day: faster in a restless realm (low stability) or one at war, slower under a lawful lord. A hoard past 2000 gold is spent on more men. A Bandit Camp tops out at 160, a Deserters' Fort at 200.
- **Notoriety** rises with every raid (more for a sack) and with every expedition the lair throws back, and slowly fades. It sets how often parties ride out, the price on the chief's head, and how widely the lair is known (*Whispered* → *Known* at 25 → *Feared* at 50 → *Infamous* at 80).

### What a lair does

- **Raiding parties.** Every 5–13 days (more often as notoriety grows) a lair with at least 12 men at home sends a party, about a third of its garrison (8–36 strong), at a town within 9 hexes. Villages and towns are picked before cities, and a town raided in the last month is mostly left alone. Up to three parties ride at once. Like any raider, a party **robs caravans** it meets (your trade route caravans too) and **attacks you** if you are within reach.
- **At the town** the party burns buildings (typically +2–10% **damage**, which cuts the town's production until the realm repairs it), kills 1–3% of its **people**, burns its **food stores**, and carries off **coin from the realm's treasury**. A cultist raid also lowers the realm's **faith unity**.
- **At your holdings.** A raider party that reaches one of your holdings raids it the way bandits always have (see *Developing Your Holdings*): your walls, watch and garrison may beat it off, and if they don't you lose people, stores and happiness, and unrest rises. A beast pack goes round the walls for the herds: people, food and unrest.
- **Home again.** A party carries everything it took back to the lair, into the **hoard**. Laden with plunder on the way home, it avoids a fight. A party destroyed in the field (by you, a patrol, or your holding's walls) costs the lair those men.
- **The realm suffers.** Once a lair's notoriety reaches 20, the realm it preys on gets a regional event, **Outlaws of …**, for as long as the lair stands. It lowers that realm's **stability** (up to −8) and its **land trade income** (up to −20%), scaled by notoriety. Low stability means less tax income and, below 35, the risk of peasant rebellion. A lair in unclaimed wilderness is the problem of the nearest realm whose towns it raids.

### Realm expeditions

Every 10 days, a realm troubled by a lair of notoriety 20 or more may send **wardens** after it. Lawful lords send them far more often, and so does a lair's infamy. The realm needs 300 gold in its treasury and soldiers to spare. The **Realm Wardens** (🛡️) march from the realm's nearest town, sized to what its scouts report of the lair. At the lair they storm it:
- **Win**, and the lair is burned out. Its hoard goes into the realm's treasury and the surviving wardens go home.
- **Lose**, and most of the wardens never come back. The lair gains notoriety and the wardens' weapons.

### Finding lairs

- **On the road.** Come within 2 hexes of a lair and you find it.
- **Tavern talk** (the notice board in any tavern) names *Known* lairs within 20 hexes with a rough location. *Feared* ones are named with their exact place.
- **Infamous** lairs are no secret: the whole country knows where they are.
- **Notice boards** post the chief of any lair with notoriety 30+ within 24 hexes; taking the notice marks the lair on your map.
- **The heralds** cry it when a lair grows infamous, and when one is burned out, by you or by a realm's wardens. **Townsfolk** within 10 hexes of a lair talk about it.

Lairs you have found show on the map as their icon in a red ring that thickens with notoriety, with the lair's name and (zoomed in) its chief. A gold ring marks a lair you have a bargain with. A faint ❔ marks one you have only heard of. **Journal → 🏕️ Outlaw Lairs** lists every lair you know of: chief, strength, parties out, raids, your bargains, the notice you hold, and the latest news of it.

### Dealing with a lair

Stand on or beside a lair and the action menu offers **Outlaw Lair: (name)** (free to open). Inside:

| Deed | AP | What happens |
|------|----|--------------|
| 🔭 **Scout** | 3 | Odds: 55% + 5% per Stealth point (−15% against a cunning chief). Success reveals the garrison, the hoard and the chief's trait, and makes every assault stage 15% weaker. Failure costs 4–10 health and puts the camp on guard for 5 days (+15% to its defences). |
| ⚔️ **Storm the lair** | 8 | Needs an army. Three battles, each fought with your full army through the usual combat (terrain, tactics, morale, casualties): the outer palisade (40% of the garrison), the camp (60%), and the chief's hold (50%, plus the chief), all behind fortifications (×1.15). Lose a stage and the assault fails; the lair gains notoriety. Win all three and the lair is **cleared**. |
| 🗡️ **Strike at the chief alone** | 4 | Odds: 25% + 5% per Stealth + 4% per Combat (+10% if scouted, −12% against a cunning chief). Success kills the chief: the lair loses a third of its men to infighting, stops raiding, and gets a new chief in 18–32 days, or scatters if too few are left. Failure costs 12–25 health and alerts the camp for a week. |
| 💰 **Pay tribute** | 1 | 60g + 4g per point of strength + 2g per point of notoriety (×1.4 for a greedy chief, ×0.8 for an honourable one). For 60 days its parties **spare you**: they won't hunt you, rob your caravans or raid your holdings. The gold goes into the hoard and buys the lair more men. The realm thinks less of you (−2 reputation) and it counts as cowardice. |
| 🗝️ **Become partners** | 1 | Only for members of the Thieves' Guild or the notorious (karma −15 or lower); not cultists or beasts. Costs 100g. Its riders spare you, and every week you get **15% of the hoard** (up to 200g). You also gain **guild standing** and **3 heat** a week in that realm. If a realm's wardens burn the lair, the prisoners name you: **+25 heat**. Storming a partner's lair breaks the partnership. |

**Clearing a lair** pays its **hoard** (gold, plus goods into your packs; whatever doesn't fit is left behind), **renown** (10 + a quarter of its notoriety), **House Prestige** (a battle won, ×1.5, written into the chronicle), and **standing with the realm** it preyed on (8 + a tenth of its notoriety). It counts as valour, its parties scatter, and the realm's *Outlaws of …* event ends.

**The chief's bounty.** If you hold the notice on a chief, killing them (storming the lair or striking alone) pays the posted price (80g + 6g per point of notoriety, plus your hunter rank's pay bonus) at the end of the day, +3 renown, and counts toward your hunter rank. If the chief dies at someone else's hand, or the lair is burned out without you, the notice lapses.

**The Steward's Counsel** warns you about a known lair within 9 hexes of your holdings (or close to you), and points out a lair within 12 hexes you could take on. **Deeds & Records** keeps count of the lairs you cleared, chiefs slain, parties broken, lairs scouted, tribute paid and partnerships.

Lairs, their chiefs, parties, hoards and your bargains are saved with your game. Older saves gain lairs on the next day.

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

Maps can be purchased from wandering cartographers at taverns or found during exploration. Reading an **ancient** map (about half of them) or a **treasure** map (about a quarter) may also mark one of the [uncharted lands](#uncharted-lands) on its exact hex.


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

Every 3 criminals you bring in raise your rank. A saga beast slain on a notice you took counts too (see [Bounties on saga beasts](#bounties-on-saga-beasts)), and it also offsets botched arrests. Each rank above the first adds +1 capture power and +10% bounty pay (up to +4 / +40%).

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
| Hold Tournament | 200g (300g at a capital) | City, combat skill ≥2 or army | Renown, gold prizes, combat XP |
| Host Festival | 260g | City | Seasonal celebration with contests |

**Tournaments.** Compete in three bouts: win all three to take the prize pool (3× the fee), two to take 40% of it. Losing a bout costs health and may leave a wound. The lists can be called once every 10 days.

Festivals provide morale boosts, diplomatic bonuses (rival kingdoms may attend), and opportunities for renown. Some include minigames like jousting and archery contests.

### Your Festival Record

Your record as a host builds over time (shown in the festival menu):

- **Fame:** +1 renown per 3 festivals hosted (up to +5), and one more rival envoy attends per 5 hosted (up to +2 more).
- **Contest veteran:** each podium finish adds +0.3 to future contest performance (up to +3).
- **Vigilance:** each past sabotage attempt cuts the chance of the next by 1% (up to −10%).
- **Novelty:** a town that has hosted one of your last 3 festivals is less impressed: −30% renown for each.
- Achievements: **Master of Revels** (host 10 festivals) and **Champion of the Lists** (5 podium finishes).

Rival adventurers nearby (see below) enter your tournaments and festivals by name: they replace some of the nameless champions in the lists, and a festival summary shows which rivals you beat (+1 renown each) and which outshone you.

## Rival Adventurers

You are not the only one chasing glory. From the first day a small cast of **6–9 named adventurers** roams the realm and pursues the same goals you do. Each has an archetype, four stats (⚔️ prowess, 🧠 cunning, 🙏 faith, 💬 charm), a level, a renown score, a home town, and an **attitude** toward you (−100 to 100) built from what you have done to them.

| Archetype | What they chase |
|-----------|-----------------|
| 🗝️ Treasure Hunter | Ruins and caves first, then quests |
| ⚔️ Sellsword Captain | Tournaments, bounties, delves; can be hired |
| 🎯 Bounty Hunter | The criminals on your notice board |
| ✝️ Pious Crusader | Tombs and the restless dead, quests |
| 💰 Merchant Adventurer | Commissions and delves |
| 👑 Would-be Usurper | Thrones: claims and succession crises |
| 🤺 Wandering Duelist | Tournaments; will always cross swords |

The cast, their names and lines live in `data/rivals.json`.

### What They Do

Rivals don't walk the map. They travel from place to place at about 6 hexes a day, rest a few days in a town, then pick their next venture:

- **Delves.** They head for the nearest unexplored ruin or cave. A rival may **clear** it, so it is no longer delvable ("already looted by Kael the Bold"), or **plunder part of it**. A partly looted site can still be delved, but its gold, goods and renown shrink (the delve entrance shows by how much). The depths can kill them.
- **Bounties.** A bounty hunter goes after a criminal on your board, or one you have already accepted, and may bring them in before you. The bounty and its pay are then gone.
- **Quests.** A rival near you may take an offer off your quest journal.
- **Contests.** They win jousts and archery contests in the towns, and enter yours by name.
- **Thrones.** An ambitious rival with 70+ renown proclaims a claim to a throne. In a succession crisis (Claims & Crowns) they back a claimant: your claimant if they like you, the other one if they hate you, with double weight in the realm they claim.

**Faith** lights their way in the tombs. In a tomb delve, each point of faith above 5 cuts a rival's risk of dying by 6% and adds 2% to their chance of clearing it outright, so Pious Crusaders (faith 7–10) are the ones who empty the barrows.

**Gold.** Rivals earn gold from delves, bounties, commissions, contests, races and ambushes, and they spend it between ventures. They keep 60g back. With more than that, they first buy **finer arms** (+1 prowess, up to 10, for 150g + 60g × their current prowess). Once their arms are as good as they get, they **hire swords** for 40 days (120g each, up to 2). Each sword adds 1.5 to their fighting power and +4% to their manhunts. A nemesis hiring swords near you gets a warning. A rich rival grows dangerous.

Notable deeds within about 14 hexes of you, and anything that touches you, arrive as end-of-day notices. Every deed goes into the **Tales of the Road** news.

### Meeting Them

When you arrive in a town where a rival is resting, you meet them and hear a line in their voice. **Adventurers Here** in the Social menu lists them, with their attitude and the last thing they remember about you:

| Deed | AP | Effect |
|------|----|--------|
| 💬 Talk | 0 | A line that matches their mood toward you |
| ⚔️ Duel | 4 | A fight to first blood. Your power is combat ×2 + strength + luck, scaled by trait, mood and treasure bonuses, against their prowess, level and hired swords. Faith steels both sides: ±0.3 per point of faith above or below 5. A devout rival (faith 7+) holds back 2 against a Pious player, unless they are your nemesis. The winner gains renown and the loser harm (armour reduces yours). Once a day per rival. |
| 💀 To the death | 4 | Only with someone who already dislikes you. If you win, they die. If you lose, you take heavy harm. |
| 🤝 Team up | 1 | Treasure hunters, sellswords, crusaders and merchants delve with you for 7 days: about +10% to every delve check, for 25% of the gold you find. A fair split warms them. |
| 💰 Hire | 1 | Sellswords, bounty hunters, treasure hunters, merchants and duelists join your army for 10 days, paid up front (60g + 35g per level). If they are lost from your ranks, they either die or leave to recover from their wounds. |
| 🏁 Race | 1 | You each stake 75g on the nearest unexplored delve site. They need a day to provision. Delve it before they arrive and you take the 150g pot and +6 renown. Otherwise they keep the pot. |
| 🗡️ Sabotage | 2 | 50g to have them waylaid. Success depends on stealth, plus 15% as a thieves' guild member. It delays their venture (or race) by 3–6 days and costs them renown. If it fails, they know it was you (−25 attitude, −2 karma). |

### Friends, Rivals and Nemeses

Attitude moves with what you do: fair splits, contracts served out and races they win warm them. Losing duels and contests to you, losing races, and sabotage cool them. They also hear what kind of person you are: each archetype cares about some of your earned traits, once when you earn one (and back again if you lose it). A Pious Crusader warms to a Pious or Merciful player and loathes a Cruel one or a Kinslayer; a Wandering Duelist respects the Brave and resents a Champion; a sellsword likes the Brave and the Generous. Rivals go from **Friend** (60+) through **Friendly**, **Neutral** and **Rival** to **Nemesis** (−60 or worse).

A nemesis acts against you:

- **Slander.** They spread 'slander' rumours through the gossip system. These carry no bounty, but they cost you renown and reputation as they spread from town to town.
- **Ambush.** About every 20 days they may come after you. If you have not moved on when they arrive, they ambush you. Beat them off and they flee wounded, or sometimes die. Lose and they take 10% of your gold. Losing a duel or an ambush may leave you **wounded** (see Wounds), twice as likely in a duel to the death.

Rivals can die in the depths, on a manhunt, under your banner or by your hand. Newcomers arrive 8–20 days later to replace the dead.

### The Hall of Heroes

**Hall of Heroes** (Social menu, at any settlement once the cast exists) ranks your renown against every living rival. It shows each rival's attitude toward you and what they are doing now ("Bound for the Sunken Ruins of Tallow (~3d)"). It also lists your current delving partner and race, your duel and race record, the latest Tales of the Road, and the fallen.

Rival state (the cast, attitudes, memories, news, partner, race) is saved with your game. Older saves get their cast on the first day after loading.

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

### The Steward's Counsel

With some forty systems running at once, it is easy to miss what matters today. Your steward reads them all and sets the most pressing matters before you. Open the **🗝️ Counsel** tab in the top bar. Its badge counts the threats the steward sees and turns red when one is critical.

The counsel ranks its items in three groups. Within a group, items are ordered by severity (critical, warning, notice, info) and then by priority:

| Group | What the steward watches |
|-------|--------------------------|
| **Threats** | Holdings under siege (critical when stores fall to a week) · a revolt raging, or a revealed faction strong enough to issue an ultimatum · unrest in a holding (60+; critical at 75 or in rebellion) · enemy or rebel war hosts within 10 hexes or marching on you · a realm's war ultimatum · a disease at a stage that can kill · 3 or fewer days of food in your pack, or starving · a ship at sea with 3 or fewer days of provisions · underworld heat (watched, posters, warrant) · petitions about to lapse · mercenaries you cannot pay or who are wavering, crews whose wages exceed your purse, companions owed wages · a companion near desertion · a nemesis within 8 hexes · a known saga's chapter turning within 5 days nearby, or a saga beast within 5 hexes · the lean weeks within 15 days while you carry under 10 food · a realm contesting your discovery · a blockade of your realm or of the port you stand in |
| **Opportunities** | A trading-company contract you already carry the goods for · cheap harvest food (20%+ under the usual price) · an unexplored delve site within 5 hexes · the bounty board in town, or a saga beast with a price on its head · a child come of age with no match or court · a royal match you can afford · an empty edict slot · a throne claim strong enough to press · a tournament you can hold here · a quest 75%+ done · a rumoured or charted uncharted land |
| **Goals** | The next milestone of your House Ambition (or a nudge to choose one) · the trait you are closest to earning (50%+) · captures to your next hunter rank · guild standing to your next thieves' guild rank · your House's Legacy score and the next rank |

Each item has a button that opens the panel to deal with it, such as the siege panel, the Royal Court, the physician, the petitions or the travel party. Items tied to a place also have a 📍 button that centres the map there. A panel that needs a town (the physician, the bounty board, a tournament) points you at the map when you are elsewhere.

**Morning brief.** At the start of each new day, one notification lists the top three matters of notice or higher, threats first. On a quiet day there is none. Turn it off with **Settings → Steward's Morning Brief**.

The counsel only reads: it never changes the game and never rolls dice. Its rules, wording, thresholds and priorities live in `data/counsel.json`, so new advice is a data entry.

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

