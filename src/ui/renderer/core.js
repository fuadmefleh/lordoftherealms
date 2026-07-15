// Renderer — core: constructor + module-scoped helpers. Instance/static methods
// are Object.assign'd onto Renderer / Renderer.prototype by the sibling modules.
import { Hex, Religion, Economy, Infrastructure } from './_imports.js';



export class Renderer {
    constructor(canvas, camera) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.camera = camera;
        this.hexSize = 54; // Radius of hex (center to vertex)
        this.world = null;
        this.player = null;

        // Hex dimensions
        this.hexWidth = Math.sqrt(3) * this.hexSize;
        this.hexHeight = 2 * this.hexSize;

        // Hover/selection state
        this.hoveredHex = null;
        this.selectedHex = null;
        this.reachableHexes = null;

        // Pre-drawn hex shapes cached
        this.terrainCache = new Map();

        // PNG tile sprites (when loaded)
        this.tileSprites = new Map();
        this.imagesLoaded = false;

        // Animation time
        this.time = 0;

        // Water animation
        this.waterAnimInterval = 1.2; // seconds between frame changes
        this.waterAnimFrame = 0;

        // Display settings
        this.showResources = true;
        this.showTerritories = false;

        // Map mode system
        // Modes: 'normal','political','religion','wealth','military','trade','culture'
        this.mapMode = 'normal';

        // Label management system to prevent overlapping
        this.labels = [];
        this.labelPadding = 5; // Extra space around labels for collision detection

        this.resize();
        window.addEventListener('resize', () => this.resize());

        // Load assets
        this.loadAssets();
    }
}
