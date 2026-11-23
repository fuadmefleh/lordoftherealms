// Renderer — the Ore map ('ores' map mode): where the mined goods lie and who
// is short of them. The tile art is left off (as on the Currents & Rivers map):
// the land is a quiet wash and each ore field (tile.ores, terrainGen 15,
// world/terrain.js _mineralFields) is tinted by its richest mineral, stronger
// toward the field's heart. A world from before the ore fields shows its
// mineral map resources instead. The sea shows its fishing grounds (tile.fishing,
// terrainGen 17: Terrain._fishingGrounds17), silver-teal by their strength.
// Over each town the player has price news of
// (systems/priceKnowledge.js — nothing here is omniscient) a row of chips: a
// filled chip a mineral (or fish) the town has plenty of, a hollow ring one it is short
// of, so where to buy and where to sell can be read off the map.
import { Renderer } from './core.js';
import { PriceKnowledge } from '../../systems/priceKnowledge.js';

/** Each mineral: its colour, its name and the market good it is sold as. */
export const ORE_KEY = [
    { id: 'iron', good: 'iron', name: 'Iron', color: [196, 78, 52] },
    { id: 'coal', good: 'coal', name: 'Coal', color: [112, 128, 150] },
    { id: 'copper', good: 'copper', name: 'Copper', color: [232, 146, 60] },
    { id: 'silver', good: 'silver_ore', name: 'Silver', color: [222, 230, 240] },
    { id: 'gold_ore', good: 'gold_ore', name: 'Gold', color: [244, 207, 85] },
    { id: 'gems', good: 'gems', name: 'Gems', color: [64, 208, 122] },
    { id: 'salt', good: 'salt', name: 'Salt', color: [240, 176, 200] },
    { id: 'oil', good: 'oil', name: 'Oil', color: [150, 96, 214] },
    // (not mined: the fishing grounds in the sea, tile.fishing, terrainGen 17 — Terrain._fishingGrounds17)
    { id: 'fish', good: 'fish', name: 'Fish', color: [120, 214, 200], sea: true },
];
const BY_ID = Object.fromEntries(ORE_KEY.filter(o => !o.sea).map(o => [o.id, o]));
const FISH = ORE_KEY.find(o => o.id === 'fish');
const SEA_IDS = new Set(['deep_ocean', 'ocean', 'coast', 'sea']);
const SEA = [18, 26, 40], LAKE = [40, 62, 84];
const LOW = [62, 64, 56], HIGH = [104, 100, 90];
// (how a known stock reading counts: short at or above, plenty at or below)
const SHORT = 1.35, PLENTY = 0.8;

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

Object.assign(Renderer.prototype, {
    /** A tile's richest mineral and how strong it lies there ({ ore, k }), or null. */
    oreOf(tile) {
        if (!tile) return null;
        if (tile.ores) {
            let best = null, k = 0;
            for (const id in tile.ores) if (BY_ID[id] && tile.ores[id] > k) { k = tile.ores[id]; best = BY_ID[id]; }
            return best ? { ore: best, k: Math.min(1, k) } : null;
        }
        // (a world before the ore fields: its mineral map resources)
        const rid = tile.resource && (tile.resource.id || tile.resource);
        const o = rid && BY_ID[String(rid).toLowerCase()];
        return o ? { ore: o, k: 1 } : null;
    },

    /** The flat colour of a hex on the Ore map (also the minimap's). */
    oreColor(tile) {
        const id = tile && tile.terrain && tile.terrain.id;
        if (id === 'lake') return rgb(LAKE);
        if (SEA_IDS.has(id)) {
            // the fishing grounds, silver-teal by their strength (older worlds: their fish banks)
            const k = typeof tile.fishing === 'number' ? tile.fishing
                : (tile.resource && (tile.resource.id || tile.resource) === 'fish' ? 0.5 : 0);
            return rgb(k > 0 ? mix(SEA, FISH.color, 0.18 + 0.6 * Math.min(1, k)) : SEA);
        }
        const e = Math.max(0, Math.min(1, ((tile.elevation ?? 0.5) - 0.42) / 0.5));
        const land = mix(LOW, HIGH, e);
        const o = this.oreOf(tile);
        return rgb(o ? mix(land, o.ore.color, 0.3 + 0.6 * o.k) : land);
    },

    /** Paint a hex's face for the Ore map (the art is left off). */
    renderOreHex(ctx, tile, corners) {
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.fillStyle = this.oreColor(tile);
        ctx.fill();
    },

    /**
     * The towns' chips on the Ore map: for each town in the player's price book,
     * the minerals it is known to have plenty of (filled) or be short of (a ring).
     */
    renderOreTowns(ctx) {
        if (this.mapMode !== 'ores' || !this.world || !this.player) return;
        const world = this.world, player = this.player;
        const z = this.camera.zoom;
        const size = this.hexSize * z;
        const W = this.canvas.width, H = this.canvas.height;
        const rad = Math.max(3.5, size * 0.13);
        const gap = rad * 2.6;
        ctx.save();
        for (const t of PriceKnowledge.towns(player)) {
            const p = this.getHexPixelPos(t.q, t.r);
            const s = this.camera.worldToScreen(p.x, p.y);
            if (s.x < -60 || s.x > W + 60 || s.y < -60 || s.y > H + 60) continue;
            const chips = [];
            for (const o of ORE_KEY) {
                const qt = PriceKnowledge.quote(player, world, t.q, t.r, o.good);
                if (!qt || !Number.isFinite(qt.scarcity)) continue;
                if (qt.scarcity >= SHORT) chips.push([o, false]);
                else if (qt.scarcity <= PLENTY) chips.push([o, true]);
            }
            if (!chips.length) continue;
            // (below the town's name, which the label pass draws over the town later)
            const y = s.y + size * 0.62 + Math.max(16, 18 * Math.min(1.5, z)) + rad;
            const x0 = s.x - (chips.length - 1) * gap / 2;
            ctx.fillStyle = 'rgba(10, 12, 20, 0.8)';
            ctx.beginPath();
            ctx.roundRect
                ? ctx.roundRect(x0 - rad * 1.6, y - rad * 1.6, (chips.length - 1) * gap + rad * 3.2, rad * 3.2, rad * 1.6)
                : ctx.rect(x0 - rad * 1.6, y - rad * 1.6, (chips.length - 1) * gap + rad * 3.2, rad * 3.2);
            ctx.fill();
            chips.forEach(([o, plenty], i) => {
                const x = x0 + i * gap;
                ctx.beginPath();
                ctx.arc(x, y, rad, 0, Math.PI * 2);
                if (plenty) { ctx.fillStyle = rgb(o.color); ctx.fill(); }
                else { ctx.strokeStyle = rgb(o.color); ctx.lineWidth = Math.max(1.5, rad * 0.55); ctx.stroke(); }
            });
        }
        ctx.restore();
    },
});
