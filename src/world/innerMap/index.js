// ============================================
// InnerMap — assembled from ./innerMap/*.js
// ============================================
import { InnerMap } from './_ref.js';
import './state.js';
import './terrain.js';
import './buildings.js';
import './interiors.js';
// Interiors planned by rules: rooms, furniture, decor (data/interiorPlans.json)
import './interiorPlanner.js';
// Hand-authored interiors (interior_editor.html) given inner walls, doorways, decor, windows and rooms
import './authoredInterior.js';
// Interiors by the hour, the season and what has happened: a layer over the plan (data/interiorState.json)
import './interiorState.js';
// A shop's real stock on its shelves, counters and barrels (data/shopStock.json)
import './shopStock.js';
import './floors.js';
// The insides of buildings kept once visited, every floor and cellar (world/interiorRecords.js)
import './persistInteriors.js';
import './movement.js';
import './npcs.js';
import './townLife.js';
import './nightWatch.js';
import './townScenes.js';
// The crowd before a proclaimed execution's scaffold (world/scaffolds.js, systems/executions.js)
import './scaffoldCrowd.js';
// The crowd at the town's fighting pit on its fight nights (world/pitRing.js, systems/pitFights.js)
import './pitCrowd.js';
import './townCourting.js';
import './townTrading.js';
import './townSickness.js';
import './townKin.js';
import './stalls.js';
import './townWoodcutters.js';
import './townMiners.js';
import './townHerbalists.js';
import './townWork.js';
import './jail.js';
import './seats.js';
import './lots.js';
import './graves.js';
import './furnitureUse.js';
import './furnishing.js';
import './household.js';
// A household in its own rooms: who sleeps in which bed, the babe's cradle, the day's hearth-keeper
import './householdRooms.js';
// The staff down to the cellar and back up: ale, wine, stores
import './cellarTrips.js';
import './encounters.js';
import './hospitality.js';
import './camp.js';
import './harbour.js';
import './deckLife.js';
import './belowDecks.js';
import './water.js';
import './mills.js';
import './swimming.js';
import './currents.js';
import './animals.js';
import './farmPlots.js';
import './cliffs.js';
import './climbing.js';
import './palms.js';
import './gates.js';
import './handBuilding.js';
import './felling.js';
import './mines.js';
import './carts.js';
import './streetSeasons.js';
import './streetWeather.js';
import './ice.js';
import './lists.js';

export { InnerMap };
