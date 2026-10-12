// Renderer — atmosphere. Weather that moves (rain falling, snow drifting,
// lightning over storms) on the charted land, and a colour grade for the
// season: fresh spring, golden summer, amber autumn, a cold pale winter,
// eased across the last days of each season. Presentation only.
import { Renderer } from './core.js';
import { Hex } from './_imports.js';

const SEASON_ORDER = ['Spring', 'Summer', 'Autumn', 'Winter'];
// soft: a soft-light wash [r, g, b, a]; desat: how far colour is drained (0–1); frost: a pale lift (0–1)
const SEASON_GRADE = {
    Spring: { soft: [150, 220, 140, 0.1], desat: 0, frost: 0 },
    Summer: { soft: [255, 200, 110, 0.14], desat: 0, frost: 0 },
    Autumn: { soft: [235, 130, 50, 0.24], desat: 0.08, frost: 0 },
    Winter: { soft: [150, 185, 240, 0.34], desat: 0.45, frost: 0.07 },
};
const BLEND_DAYS = 6;

const frac = (v) => v - Math.floor(v);
const rnd = (q, r, i) => frac(Math.sin(q * 12.9898 + r * 78.233 + i * 37.719) * 43758.5453);

Object.assign(Renderer.prototype, {
    /** The season's light over the land (drawn beneath units, labels and HUD marks). */
    renderSeasonGrade(ctx) {
        const world = this.world;
        if (!world || !world.season || this.mapMode !== 'normal') return;
        const idx = SEASON_ORDER.indexOf(world.season);
        if (idx < 0) return;
        const cur = SEASON_GRADE[world.season];
        const next = SEASON_GRADE[SEASON_ORDER[(idx + 1) % 4]];
        const dayOfSeason = ((world.day - 1) % 30) + 1;
        // Ease into the coming season over its last few days
        const t = Math.max(0, (dayOfSeason - (30 - BLEND_DAYS)) / BLEND_DAYS);
        const mix = (a, b) => a + (b - a) * t;
        const soft = cur.soft.map((v, i) => mix(v, next.soft[i]));
        const desat = mix(cur.desat, next.desat);
        const frost = mix(cur.frost, next.frost);

        const w = this.canvas.width, h = this.canvas.height;
        ctx.save();
        if (desat > 0.01) {
            ctx.globalCompositeOperation = 'saturation';
            ctx.fillStyle = `rgba(128,128,128,${desat.toFixed(3)})`;
            ctx.fillRect(0, 0, w, h);
        }
        if (soft[3] > 0.01) {
            ctx.globalCompositeOperation = 'soft-light';
            ctx.fillStyle = `rgba(${soft[0] | 0},${soft[1] | 0},${soft[2] | 0},${soft[3].toFixed(3)})`;
            ctx.fillRect(0, 0, w, h);
        }
        if (frost > 0.005) {
            ctx.globalCompositeOperation = 'screen';
            ctx.fillStyle = `rgba(205,220,245,${frost.toFixed(3)})`;
            ctx.fillRect(0, 0, w, h);
        }
        ctx.restore();
    },

    /** Falling rain, drifting snow and lightning over the charted land. */
    renderWeather(ctx) {
        const world = this.world;
        if (!world || !world.weather) return;

        const bounds = this.camera.getVisibleBounds();
        const size = this.hexSize;
        const zoom = this.camera.zoom;
        const s = size * zoom;
        const hexWidth = Math.sqrt(3) * size;
        const rowHeight = hexWidth * 0.75;
        const minR = Math.max(0, Math.floor(bounds.top / rowHeight) - 1);
        const maxR = Math.min(world.height - 1, Math.ceil(bounds.bottom / rowHeight) + 1);
        const t = this.time;

        const rain = [];   // x, y, x2, y2 …
        const flakes = []; // x, y, radius …
        let storm = 0, wet = 0;

        for (let r = minR; r <= maxR; r++) {
            const offsetX = (r % 2 === 0) ? hexWidth / 2 : 0;
            const q0 = Math.floor((bounds.left - offsetX) / hexWidth) - 1;
            const q1 = Math.ceil((bounds.right - offsetX) / hexWidth) + 1;
            for (let q = q0; q <= q1; q++) {
                const wq = Hex.wrapQ(q, world.width);
                // The uncharted world is cloud already — weather shows on known land
                if (!world.tiles[r][wq].explored) continue;
                const weather = world.weather.getWeather(wq, r);
                const type = weather.type;
                if (type !== 'rain' && type !== 'storm' && type !== 'snow' && type !== 'blizzard') continue;

                const pos = this.getHexPixelPos(q, r);
                const c = this.camera.worldToScreen(pos.x, pos.y);
                const cy = c.y + 0.13 * s; // the sprite's visual centre

                if (type === 'rain' || type === 'storm') {
                    const n = type === 'storm' ? 9 : 6;
                    const speed = type === 'storm' ? 1.9 : 1.3;
                    const slant = type === 'storm' ? 0.5 : 0.25;
                    for (let i = 0; i < n; i++) {
                        const p = frac(rnd(wq, r, i) + t * speed * (0.85 + 0.3 * rnd(wq, r, i + 9)));
                        const x = c.x + (rnd(wq, r, i + 3) - 0.5) * 1.5 * s - slant * p * s;
                        const y = cy - 0.8 * s + p * 1.6 * s;
                        rain.push(x, y, x - slant * 0.22 * s, y + 0.22 * s);
                    }
                    wet++;
                    if (type === 'storm') storm++;
                } else {
                    const n = type === 'blizzard' ? 12 : 7;
                    const speed = type === 'blizzard' ? 0.55 : 0.22;
                    for (let i = 0; i < n; i++) {
                        const p = frac(rnd(wq, r, i) + t * speed * (0.8 + 0.4 * rnd(wq, r, i + 9)));
                        const sway = Math.sin(t * 1.6 + i * 2.1 + wq) * 0.12 * s;
                        const x = c.x + (rnd(wq, r, i + 3) - 0.5) * 1.5 * s + sway - (type === 'blizzard' ? p * 0.6 * s : 0);
                        const y = cy - 0.8 * s + p * 1.6 * s;
                        const rad = (0.6 + rnd(wq, r, i + 5)) * 1.3 * zoom;
                        flakes.push(x, y, rad);
                    }
                }
            }
        }

        ctx.save();
        if (wet) {
            ctx.strokeStyle = 'rgba(190, 210, 255, 0.45)';
            ctx.lineWidth = Math.max(0.75, 1.1 * zoom);
            ctx.lineCap = 'round';
            ctx.beginPath();
            for (let i = 0; i < rain.length; i += 4) {
                ctx.moveTo(rain[i], rain[i + 1]);
                ctx.lineTo(rain[i + 2], rain[i + 3]);
            }
            ctx.stroke();
        }
        if (flakes.length) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
            ctx.beginPath();
            for (let i = 0; i < flakes.length; i += 3) {
                ctx.moveTo(flakes[i] + flakes[i + 2], flakes[i + 1]);
                ctx.arc(flakes[i], flakes[i + 1], flakes[i + 2], 0, Math.PI * 2);
            }
            ctx.fill();
        }

        // Storms: the sky lowers, and now and then lightning — a flash and its flicker
        if (storm) {
            ctx.fillStyle = `rgba(0, 0, 20, ${Math.min(0.14, storm * 0.01).toFixed(3)})`;
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            if (this._nextLightning == null) this._nextLightning = t + 3 + Math.random() * 6;
            const since = t - this._nextLightning;
            if (since >= 0) {
                const flash = since < 0.08 ? 0.32 : since < 0.16 ? 0.05 : since < 0.24 ? 0.2 : 0;
                if (flash) {
                    ctx.fillStyle = `rgba(225, 235, 255, ${flash})`;
                    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                }
                if (since > 0.3) this._nextLightning = t + 5 + Math.random() * 9;
            }
        }
        ctx.restore();
    },

    /** A soft darkening toward the screen's edges, framing the map under the HUD. */
    renderVignette(ctx) {
        const w = this.canvas.width, h = this.canvas.height;
        if (!this._vignette || this._vignette.w !== w || this._vignette.h !== h) {
            const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
            g.addColorStop(0, 'rgba(4,6,12,0)');
            g.addColorStop(1, 'rgba(4,6,12,0.55)');
            this._vignette = { w, h, g };
        }
        ctx.fillStyle = this._vignette.g;
        ctx.fillRect(0, 0, w, h);
    },
});
