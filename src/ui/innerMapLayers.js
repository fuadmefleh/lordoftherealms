// InnerMapRenderer render layers — barrel (implementation split under ./innerMapLayers/).
// Side-effect imports that Object.assign methods onto InnerMapRenderer.
import './innerMapLayers/terrainRoads.js';
// Hand-authored interiors dressed: drawn inner walls, decor, windows (world/innerMap/authoredInterior.js)
import './innerMapLayers/authoredInterior.js';
import './innerMapLayers/caves.js';
import './innerMapLayers/groundCache.js';
import './innerMapLayers/objectsBuildings.js';
import './innerMapLayers/entities.js';
import './innerMapLayers/waterFx.js';
import './innerMapLayers/surfaceFish.js';
import './innerMapLayers/floodWater.js';
import './innerMapLayers/riverDrift.js';
import './innerMapLayers/fishTraps.js';
// The harbour and the river at work: the slip, the careening beach, dockers, boats, barges, the ferry (ui/innerMapPort.js)
import './innerMapLayers/portLife.js';
import './innerMapLayers/underwater.js';
import './innerMapLayers/ambient.js';
import './innerMapLayers/streetSeasons.js';
import './innerMapLayers/weatherFx.js';
import './innerMapLayers/ice.js';
// A foul well marked on the street map (ui/innerMapWater.js)
import './innerMapLayers/wells.js';
