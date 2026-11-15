# Things To Do

## Economy

- [ ] **Base prices learn from the market.** Every good's `basePrice` (data/playerEconomy.json) is a fixed anchor that town prices (`Economy.marketAskBase` × `SettlementMarket.scarcity`) are measured against. Let each anchor drift slowly toward what the good actually trades for across the world (a weighted average of town prices or trades, over seasons and years), so a good that is dear everywhere for years becomes "normally" dear. Keep it saved, deterministic and bounded.
  - Seen 2026-11-14 (seed 101, 240 days): boots' median town price was 95g against a 48g anchor; leather was 35g against 18g.
- [ ] **Craftsmen won't sell below their materials.** A made good's price shouldn't fall below what its inputs cost at that market, plus a little for the work (the town trades in data/markets.json `recipes`, and the craft recipes). It fixes uneven margins: a cobbler turns 18g of leather into 48g boots, while a quilter turns 35g of cloth and wool into a 40g gambeson.
- [ ] **Boot prices for troop kits.** Kitting recruits costs more now that every soldier gets boots. Check this once the two items above land, rather than hand-setting prices.

## Performance

- [ ] **Graphics memory of the giant repainted sheets (optional).** Three of them are used: `assets/modern/lpc/crops.png` (4096×4096), `…/Doors/32x64px Doors/15 Panel Door A.png` (3584×4096) and `…/ThatchedHouses/tilesets/farming_fishing.png` (2560×2560), about 150 MB of graphics memory together. The first-draw stall is fixed (`warmSheet`, core/customSheets.js). Shrinking them to 2× would halve the memory but soften the art at close zoom, so only do it if memory becomes a problem.
- [ ] **Unused painted sheets.** `assets/modern/lpc/Terrain/trees_{spring,summer,autumn,winter}.png` and `palm_trees.png` aren't listed in `modernSheets`, so they're never loaded (the pixel trees stay). Delete them from the repo if they're not wanted.

## From the century soak (2026-11-14)

- [ ] **Townsfolk rosters bloat late games.** By year 100 (seed 303) about 5,800 people, 37% of them dead (the dead are kept 40 years): about 6 MB of the save and about 55 ms a day in Townsfolk and IllnessPlayer. Prune the dead sooner, without breaking graveyards, or make the daily trade and worship catch-ups cheaper.
- [ ] **Buy-and-sell-back loop.** Late on seed 202, liquor at Dewglen bought for 44 sold back for 48.09 in the same market, possibly through a trading-post factor. Not reproduced yet.
- [ ] **Coin piles up in banks** (0.77M → 1.8M over a century). Seed 303's crown treasuries drift down to 37k.
- [ ] **The player's known-NPC list is never pruned.** It reaches about 285 entries and 240 KB in a century.
- [ ] **Pathfinding failures:** 113–186 warnings a century, about one a day in some runs.
- [x] **The default 5-year soak fails on `coloniesFounded`.** Passing again (bot colony search); `worksFunded` also fixed (the bot only tried towns of 2,000+).

## From the playability pass (2026-11-14)

Fixed this pass: town coin draining into crown chests and free villages (systems/fiscal.js reserve vs realm coin, MoneySupply._freeTowns, crowns don't borrow while flush); advanced origins starving (court stipends never paid from the head's last 40g, lower seeded stipends; empty pack → whole purse on bread; player gangs' lieutenants rehire; guild stipend 8% of the treasury); housing upkeep rescaled and paid to the town; cross-border NPC trade on small maps (frontier links); hollow sweep 24 (19 fixes); landless heads feel no court pressure; annals prose (no game numbers, "the Kingdom of"); estranged cadet branches scheme; house quests ~1.9/yr in the soak.

- [ ] **Coin made from nothing** (the census grows ~5–10k per 120 days on a small world): `LandMarket._holderMonth` (first purse per holder, ~57k on a 10-realm world), `RivalHouses.processDay`, `Concessions.processDay`, `Underwriting._tick`, `Couriers` (week 1). `NPCLords` pursueTrade / pursueSurvival move town coin to the treasury unbooked.
- [ ] **Small-map nobles are poor.** In a small 4-realm browser world the great lord's estates paid 101–139g a month (harness 80×60 worlds: 330–1,000). Check estate counts per House on small maps.
- [ ] **Origins give no home.** Lords, monarchs and priests pay an inn each night in their own seat (~32g/month). A manor at the seat (upkeep is now 4g/day) would fit the blurbs.
- [ ] **Letters cut a long wait short** about every 7–10 days ("a letter that wants an answer"). Consider letting the Wait panel skip letters that can wait.
- [ ] **Bounty hunters and raiders** take 6–26k a decade from the soak bot's purse: check the balance.
- [ ] **Hollow sweep leftovers:** street-map mining doesn't deplete the hex deposit (`Hinterland.deplete`); companion `hp` and mine `text.leave` (src/ui); display-only stats never shown (stewards, mints, hearsay, crisis acts, pressure clocks, climate era labels); a lair bounty is paid in full when crown and town are both broke.
- [ ] **Rivals' role label.** The crown's House is now stored as `name` + `role` ("the crown"); no panel shows `role` yet.

## Arms & kit

- [ ] **Rival House retinues use the new kit slots** (legs, feet, hands). `systems/rivalHouses.js` still buys and tracks only main, off, head and body.
- [ ] **Glove and gauntlet art on the character.** No LPC glove sheets exist, so gloves aren't drawn.

## To check in the browser

- [ ] The hearsay panel's "(of the late X)" label and the inherited greetings after a succession.
- [ ] The arms panel's "N in their own shoes" note, and soldiers drawn in boots and leg harness.
- [ ] Animal companions: a dog fighting a beast, the household guard set to Wait, a cat kept at a house, and a day ending with animals in the party.
