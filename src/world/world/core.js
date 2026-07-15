// World — core: constructor + module-scoped helpers. Instance/static methods
// are Object.assign'd onto World / World.prototype by the sibling modules.
import { Terrain, Kingdom, WeatherSystem, NPCLords, Hex, Utils, WorldEvents, WorldUnit, Characters, Religion, Culture, Peoples, Colonization, Cartography, KingdomAI } from './_imports.js';



export class World {
    constructor(width = 70, height = 45) {
        this.width = width;
        this.height = height;
        this.tiles = [];
        this.kingdoms = [];
        this.day = 1;
        this.season = 'Spring';
        this.baseYear = 853;
        this.year = this.baseYear;
        this.history = [];
        this.events = [];
        this.units = [];
        this.weather = new WeatherSystem(this);
    }
}
