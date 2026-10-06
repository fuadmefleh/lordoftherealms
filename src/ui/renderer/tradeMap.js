// Renderer — the trade map ('prices' map mode): what the player knows of one
// good's prices across the map. Each town in the player's price book
// (systems/priceKnowledge.js) gets a marker coloured by the good's stock
// reading there (glut blue … dearth red), its last-known asking price and the
// age of that news; stale news fades. Lines join known towns along the
// markets' trade links (gold by land, blue by sea, thicker with caravan
// traffic; red and dashed where merchants shun a road after a loss), and the
// merchant caravans and trading ships in sight show the road ahead of them
// (bright when they carry the good). Nothing here is omniscient: a town the
// player has no news of shows nothing.
import { Renderer } from './core.js';
import { PriceKnowledge } from '../../systems/priceKnowledge.js';
import { MerchantCaravans } from '../../systems/merchantCaravans.js';
import { SettlementMarket } from '../../world/settlementMarket.js';
import { DataLoader } from '../../core/dataLoader.js';

function goodDef(id) {
    const gd = DataLoader._gamedata;
    const goods = (gd && gd.playerEconomy && gd.playerEconomy.GOODS) || {};
    return goods[String(id).toUpperCase()] || { id, name: id, icon: '📦' };
}

Object.assign(Renderer.prototype, {
    /** The good the trade map shows (renderer.tradeMapGood, else grain). */
    tradeMapGoodId() {
        return this.tradeMapGood || 'grain';
    },

    /** Step the trade map to the next (or previous) good the player has news of. */
    cycleTradeMapGood(step = 1) {
        const list = this.player ? PriceKnowledge.knownGoods(this.player) : [];
        const all = list.length ? list : SettlementMarket.config().goodIds;
        const i = all.indexOf(this.tradeMapGoodId());
        this.tradeMapGood = all[((i < 0 ? 0 : i + step) % all.length + all.length) % all.length];
        return this.tradeMapGood;
    },

    _screenOf(q, r) {
        const pos = this.getHexPixelPos(q, r);
        return this.camera.worldToScreen(pos.x, pos.y);
    },

    renderTradeMap(ctx) {
        if (this.mapMode !== 'prices' || !this.world || !this.player) return;
        const world = this.world;
        const player = this.player;
        const goodId = this.tradeMapGoodId();
        const good = goodDef(goodId);
        const z = this.camera.zoom;
        const size = this.hexSize * z;
        const W = this.canvas.width, H = this.canvas.height;
        const C = PriceKnowledge.config();
        const towns = PriceKnowledge.towns(player);
        const known = new Map(towns.map(t => [t.key, t]));
        const trade = world.merchantTrade || {};
        const fear = trade.fear || {};
        const traffic = trade.traffic || {};
        const day = world.day || 0;
        const off = (s) => s.x < -80 || s.x > W + 80 || s.y < -80 || s.y > H + 80;
        ctx.save();

        // Trade links between towns the player knows
        const drawn = new Set();
        for (const t of towns) {
            const tile = world.getTile(t.q, t.r);
            const links = tile && tile.settlement && tile.settlement.market && tile.settlement.market.links;
            if (!Array.isArray(links)) continue;
            for (const [q, r, , sea] of links) {
                const other = `${q},${r}`;
                if (!known.has(other)) continue;
                const lk = MerchantCaravans.linkKey(t, { q, r });
                if (drawn.has(lk)) continue;
                drawn.add(lk);
                const a = this._screenOf(t.q, t.r), b = this._screenOf(q, r);
                if (off(a) && off(b)) continue;
                const shunned = Number.isFinite(fear[lk]) && day < fear[lk];
                const busy = Math.min(6, traffic[lk] || 0);
                ctx.strokeStyle = shunned ? 'rgba(231, 76, 60, 0.85)' : sea ? 'rgba(90, 160, 230, 0.5)' : 'rgba(245, 197, 66, 0.45)';
                ctx.lineWidth = Math.max(1, (1.5 + busy * 0.6) * z);
                ctx.setLineDash(shunned ? [5 * z, 4 * z] : sea ? [8 * z, 5 * z] : []);
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
            }
        }
        ctx.setLineDash([]);

        // Caravans and trading ships in sight: the road ahead of them
        for (const u of MerchantCaravans.traders(world)) {
            const ut = world.getTile(u.q, u.r);
            if (!ut || !ut.visible || !Array.isArray(u.route)) continue;
            const carries = !!(u.cargo && u.cargo[goodId] > 0);
            ctx.strokeStyle = carries ? 'rgba(255, 230, 120, 0.9)' : 'rgba(220, 220, 220, 0.35)';
            ctx.lineWidth = Math.max(1, (carries ? 2.5 : 1.2) * z);
            ctx.setLineDash([3 * z, 3 * z]);
            ctx.beginPath();
            const start = Math.max(0, Math.floor(u.step || 0));
            for (let i = start * 2; i < u.route.length; i += 2) {
                const s = this._screenOf(u.route[i], u.route[i + 1]);
                if (i === start * 2) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
            }
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // The markers: price, stock reading and the age of the news
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const k of PriceKnowledge.known(player, world, goodId)) {
            const s = this._screenOf(k.q, k.r);
            if (off(s)) continue;
            const label = SettlementMarket.label(k.scarcity);
            const fade = k.age <= C.freshDays ? 1 : Math.max(0.4, 1 - (k.age - C.freshDays) / Math.max(1, C.staleDays * 2));
            ctx.globalAlpha = fade;
            ctx.fillStyle = 'rgba(10, 12, 20, 0.85)';
            ctx.beginPath();
            ctx.arc(s.x, s.y - size * 0.55, Math.max(9, size * 0.42), 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = label.color;
            ctx.lineWidth = Math.max(2, 3 * z);
            ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.font = `bold ${Math.max(9, 12 * z)}px sans-serif`;
            ctx.fillText(`${k.ask}g`, s.x, s.y - size * 0.55);
            ctx.font = `${Math.max(8, 9.5 * z)}px sans-serif`;
            ctx.fillStyle = k.age > C.staleDays ? 'rgba(255, 170, 150, 0.95)' : 'rgba(230, 230, 230, 0.95)';
            const src = PriceKnowledge.sourceInfo(k.src);
            ctx.fillText(`${src.icon} ${PriceKnowledge.ageText(k.age)}`, s.x, s.y - size * 0.55 + Math.max(14, size * 0.6));
        }
        ctx.globalAlpha = 1;

        // The legend
        const lines = [
            `${good.icon || '📦'} ${good.name} — what you know (${towns.length} towns)`,
            'G: next good · Shift+G: previous · M: map modes',
        ];
        ctx.font = '12px sans-serif';
        const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 20;
        ctx.fillStyle = 'rgba(12, 18, 32, 0.88)';
        ctx.fillRect(10, 60, w, 22 + lines.length * 16 + 16);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#f5c542';
        ctx.fillText(lines[0], 20, 74);
        ctx.fillStyle = 'rgba(220, 220, 220, 0.9)';
        ctx.fillText(lines[1], 20, 90);
        let x = 20;
        for (const l of SettlementMarket.config().labels) {
            ctx.fillStyle = l.color;
            ctx.fillRect(x, 102, 10, 10);
            ctx.fillStyle = 'rgba(220, 220, 220, 0.9)';
            ctx.fillText(l.label, x + 13, 107);
            x += ctx.measureText(l.label).width + 24;
        }
        ctx.restore();
    },
});
