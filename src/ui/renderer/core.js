// Renderer — core: constructor + module-scoped helpers. Instance/static methods
// are Object.assign'd onto Renderer / Renderer.prototype by the sibling modules.
import { Hex, Religion, Economy, Infrastructure } from './_imports.js';
import { installHiDpi } from '../hiDpi.js';

/**
 * How far (in hex radii) the visual centre of a terrain tile's top face sits
 * below its grid point. The 256x384 tile art is bottom-anchored at
 * centre + 1 radius, so the face runs from -0.732 to +1.0 radii and centres
 * at 1 - sqrt(3)/2 ≈ 0.134. Anything meant to sit "in the middle of the hex"
 * (place markers, icons, frame sprites) centres on this, not the grid point.
 */
export const HEX_FACE_DY = 1 - Math.sqrt(3) / 2;


export class Renderer {
    constructor(canvas, camera) {
        this.canvas = installHiDpi(canvas);
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
