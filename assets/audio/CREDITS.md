# Sound and music credits

Every recorded sound and music file in `assets/audio/` is listed here, with its source page,
author and licence. All are **CC0 / public domain** except one file under **CC BY 4.0**
(credited below, as that licence requires). Nothing here is "non-commercial" or "personal use".
The files were cut, mixed to mono (sound effects and ambience), looped, loudness-matched and
re-encoded as Ogg Vorbis for the game. The original packs hold more than was used. Beds are
mono at 22.05 kHz (32 kHz for the hiss of rain, surf, sea and wind) and are decoded at that
rate (`src/systems/audio/samples.js` `decodeRateFor`); one-shots are mono 44.1 kHz. Sounds
from freesound.org were taken from its public preview of each CC0 sound.

To add a sound: put the `.ogg` under `music/`, `amb/` or `sfx/`, add it to the bank in
`src/systems/audio/samples.js`, and add a line here.

## Music (`music/`) — RandomMind, CC0

| File | Track | Source |
|------|-------|--------|
| `title_exploration.ogg` | Medieval: Exploration | https://opengameart.org/content/medieval-exploration |
| `road_bards_tale.ogg` | Medieval: The Bard's Tale | https://opengameart.org/content/medieval-the-bards-tale |
| `road_harvest_season.ogg` | Medieval: Harvest Season | https://opengameart.org/content/medieval-harvest-season |
| `town_minstrel_dance.ogg` | Medieval: Minstrel Dance | https://opengameart.org/content/medieval-minstrel-dance |
| `town_market_day.ogg` | Medieval: Market Day | https://opengameart.org/content/medieval-market-day |
| `town_old_tower_inn.ogg` | Medieval: The Old Tower Inn | https://opengameart.org/content/medieval-the-old-tower-inn |
| `court_kings_feast.ogg` | Medieval: King's Feast | https://opengameart.org/content/medieval-kings-feast |
| `battle.ogg` | Medieval: Battle | https://opengameart.org/content/medieval-battle |
| `night_rising_moon.ogg` | Fantasy: Rising Moon | https://opengameart.org/content/fantasy-rising-moon |

## Ambience (`amb/`)

| File | Source | Author | Licence |
|------|--------|--------|---------|
| `day_birds.ogg` | https://opengameart.org/content/ambient-bird-sounds | isaiah658 | CC0 |
| `forest.ogg` | https://opengameart.org/content/forest-ambience | TinyWorlds | CC0 |
| `night_crickets.ogg` | https://opengameart.org/content/crickets-ambient-noise-loopable | wolfgang | CC0 |
| `owl_1.ogg`, `owl_2.ogg`, `owl_3.ogg` | https://commons.wikimedia.org/wiki/File:Tawny_owl_calling_at_night_in_Tuntorp,_Brastad,_Sweden.ogg | W.carter | **CC BY 4.0** — "Tawny owl calling at night in Tuntorp, Brastad, Sweden" by W.carter, https://creativecommons.org/licenses/by/4.0/ (excerpts) |
| `wind.ogg` | https://opengameart.org/content/icy-heights (wind.ogg) | écrivain | CC0 |
| `wind_gust.ogg` | https://opengameart.org/content/wind-whoosh-loop | SketchMan3 | CC0 |
| `surf.ogg`, `sea.ogg` | https://opengameart.org/content/sea-and-river-wave-sounds | RandomMind | CC0 |
| `rain_light.ogg`, `rain_heavy.ogg` | https://opengameart.org/content/rain-loopable | ylmir | CC0 |
| `dungeon.ogg` | https://opengameart.org/content/loopable-dungeon-ambience | JaggedStone | CC0 |
| `tavern.ogg` (mixed from two) | https://freesound.org/people/dazzamoo/sounds/651364/ ("background_chatter_tavern.wav") | dazzamoo | CC0 |
| | https://freesound.org/people/brunoboselli/sounds/695295/ ("Pirate Tavern": voices, glasses, clinks) | brunoboselli | CC0 |
| `town_street.ogg`, `market.ogg` (part), `camp.ogg` (part) | https://freesound.org/people/nicoproson/sounds/648483/ ("CROWD village square.wav", St Gildas de Rhuys) | nicoproson | CC0 |
| `market.ogg` (part) | https://freesound.org/people/knufds/sounds/504906/ ("Crowd walla") | knufds | CC0 |
| `camp.ogg` (part: kit clinking) | https://freesound.org/people/lukabea/sounds/707667/ ("Armor Chinks.WAV") | lukabea | CC0 |
| `choir.ogg` | https://freesound.org/people/tullio/sounds/780488/ ("Gregorian choir & organ in Rome", San Paolo fuori le mura) | tullio | CC0 |
| `sermon.ogg` | https://freesound.org/people/jcammar950/sounds/689543/ ("Clerigo medieval": a priest speaking Latin) | jcammar950 | CC0 |
| `drill.ogg` | https://freesound.org/people/martian/sounds/333907/ ("squad march.wav") | martian | CC0 |
| `crowd.ogg` | https://opengameart.org/content/crowd-shoutingspeaking-ambience | StarNinjas | CC0 |
| `cart.ogg` | https://freesound.org/people/craigsmith/sounds/437078/ ("G52-05-Ox Cart.wav") | craigsmith | CC0 |
| `hall_murmur.ogg` | https://commons.wikimedia.org/wiki/File:Group_discussion_3.ogg (from pdsounds.org) | ezwa | Public domain |
| `church_bells.ogg` | https://commons.wikimedia.org/wiki/File:Church_bells_-_Leverkusen,_2007.oga (from pdsounds.org) | natalie | Public domain |

## Sound effects (`sfx/`)

| Files | Source | Author | Licence |
|-------|--------|--------|---------|
| `step_wood_1..6`, `door_open_*`, `door_close_*`, `coins_*`, `lock_latch`, `lock_click`, `page_*`, `book_open`, `book_close`, `chop_*`, `creak_*`, `draw_blade` | https://opengameart.org/content/50-rpg-sound-effects (Kenney RPG Audio) | Kenney (kenney.nl) | CC0 |
| `ui_click_*`, `ui_confirm`, `ui_error`, `ui_notify`, `ui_open`, `ui_close` | https://opengameart.org/content/interface-sounds (Kenney Interface Sounds) | Kenney (kenney.nl) | CC0 |
| `step_stone_1..6`, `step_grass_1..6` | https://opengameart.org/content/fantozzis-footsteps-grasssand-stone | Fantozzi (posted by qubodup) | CC0 |
| `step_wood_7`, `step_wood_8`, `step_stone_7`, `step_dirt_1`, `step_leaves_*`, `step_mud_*` | https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud | TinyWorlds | CC0 |
| `step_snow_1..4` | https://opengameart.org/content/4-dry-snow-steps | qubodup | CC0 |
| `step_snow_5..8` | https://opengameart.org/content/9-wet-snow-steps | qubodup | CC0 |
| `step_water_*`, `splash_*` | https://opengameart.org/content/6-short-water-splashes | ezwa (posted by qubodup) | CC0 |
| `sword_clash_1..6` | https://opengameart.org/content/20-sword-sound-effects-attacks-and-clashes | StarNinjas | CC0 |
| `sword_swing_1..4` | https://opengameart.org/content/20-sword-sound-effects-attacks-and-clashes | StarNinjas | CC0 |
| `bow_loose_1`, `bow_loose_2`, `crossbow_loose` | https://opengameart.org/content/medieval-sound-effects-weapon-textures | Ben Jaszczak & Brian Nelson (posted by MedicineStorm) | CC0 |
| `fish_reel`, `fish_splash` | https://opengameart.org/node/87279 (Fisheefects; offered under CC0, CC-BY 4.0 or OGA-BY 3.0 — used under CC0) | You're Perfect Studio | CC0 |
| `fish_cast` | https://opengameart.org/content/water-splash-and-sand-footsteps | Peludo | CC0 |
| `chest_open` | https://opengameart.org/content/open-chest-sfx | Oiboo | CC0 |
| `lockpick` | https://opengameart.org/node/159980 (Lockpicking Sound) | Tegurd | CC0 |
| `unlock` | https://opengameart.org/content/opening-lock-and-door | rpg | CC0 |
| `anvil_1`, `anvil_2` | https://opengameart.org/node/108999 (Hammer on Anvil) | themightyglider | CC0 |
| `anvil_3` | https://opengameart.org/node/129607 (Blacksmith's Hammer) | vishwajai | CC0 |
| `thunder_near` | https://opengameart.org/content/rain-long-thunder | WuxiaScrub | CC0 |
| `thunder_far` | https://commons.wikimedia.org/wiki/File:Thunder_and_rain_on_a_v.ogg (from pdsounds.org) | ezwa | Public domain |
| `wave_1..3` | https://opengameart.org/content/beach-ocean-waves (from freesound.org/people/jasinski/sounds/18363) | jasinski (posted by qubodup) | CC0 |
| `hoof_1..4` | https://freesound.org/people/swiftoid/sounds/182504/ ("Horse Clip Clopping Downhill") | swiftoid | CC0 |
| `snort_1..4` | https://freesound.org/people/craigsmith/sounds/437111/ ("G38-16-Four Horse Snorts.wav") | craigsmith | CC0 |
| `handbell_1..3` | https://freesound.org/people/SoundsExciting/sounds/204360/ ("Hand Bell") | SoundsExciting | CC0 |
| `drill_shout` | https://freesound.org/people/Jace/sounds/57204/ ("Men Shouting Hey.wav") | Jace | CC0 |
| `crowd_cheer_1`, `crowd_cheer_2` | https://freesound.org/people/jonsept/sounds/449915/ ("crowd roar.WAV") | jonsept | CC0 |
| `crowd_cheer_3` | https://freesound.org/people/benfree/sounds/130568/ ("RoaringCrowd.wav") | benfree | CC0 |
| `cannon_fire`, `cannon_hit`, `cannon_miss` | https://opengameart.org/content/battle-at-sea (cannon_fire_1, cannon_hit_ship_short, cannon_miss_1) | Thimras | CC0 |

Licence texts: CC0 1.0 — https://creativecommons.org/publicdomain/zero/1.0/ ·
CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
