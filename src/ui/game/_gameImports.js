// ============================================
// GAME IMPORTS — shared re-exports for src/ui/game/ subfolder
// ============================================

export { Camera } from '../camera.js';
export { Renderer } from '../renderer.js';
export { Player } from '../../player/player.js';
export { World } from '../../world/world.js';
export { SaveLoad } from '../../systems/saveLoad.js';
export { Terrain } from '../../world/terrain.js';
export { Banking, MarketDynamics, Taxation } from '../../systems/marketDynamics.js';
export { Characters } from '../../world/characters.js';
export { Minimap } from '../minimap.js';
export { UI } from '../ui.js';
export { Quests } from '../../systems/quests.js';
export { Achievements } from '../../systems/achievements.js';
export { Technology } from '../../systems/technology.js';
export { Relationships } from '../../systems/relationships.js';
export { Ships } from '../../systems/ships.js';
export { Titles } from '../../systems/titles.js';
export { Councils } from '../../systems/councils.js';
export { InnerMap } from '../../world/innerMap.js';
export { WorldEvents } from '../../world/worldEvents.js';
export { WorldUnit } from '../../world/units.js';
export { Trading } from '../../player/playerEconomy.js';
export { InnerMapRenderer } from '../innerMapRenderer.js';
export { InnerMapCharacters } from '../innerMapCharacters.js';
export { InnerMapCombat } from '../innerMapCombat.js';
export { LightSystem } from '../lightSystem.js';
export { ModStore } from '../../systems/modStore.js';
export { audioManager } from '../../systems/audio.js';
export { DataLoader } from '../../core/dataLoader.js';
export { Hex } from '../../core/hex.js';
export { Utils } from '../../core/utils.js';
export { PlayerActions } from '../../player/playerActions.js';
export { PlayerEconomy } from '../../player/playerEconomy.js';
export { PlayerMilitary } from '../../player/playerMilitary.js';
export { ActionMenu } from '../actionMenu.js';
export { Housing } from '../../systems/housing.js';
export { House } from '../../systems/house.js';
export { Schemes } from '../../systems/schemes.js';
export { RealmWars } from '../../systems/realmWars.js';
export { Espionage } from '../../systems/espionage.js';
export { Gossip } from '../../systems/gossip.js';
export { Tavern } from '../../player/tavern.js';
export { Economy } from '../../world/economy.js';
export { TiledExport } from '../../systems/tiledExport.js';
export { CustomObjects } from '../../world/customObjects.js';
export { CustomBuildings } from '../../world/customBuildings.js';
export { Hotbar } from '../hotbar.js';
export { NpcDialog } from '../npcDialog.js';

// Side-effect imports: these extend InnerMapRenderer via Object.assign
import '../innerMapLayers.js';
import '../innerMapUI.js';


