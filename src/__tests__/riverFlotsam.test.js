/**
 * The rivers carry things down on their own (systems/riverFlotsam.js):
 * sticks, logs, reeds, what people lose. Deterministic (hashes of the seed
 * and the day), weighted to the lower reaches, wetter seasons and towns,
 * capped in the world; a watched hex has things come down into it; a purse
 * holds coin, a bottle a note.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

let DataLoader, Hex, RiverDrift, RiverFlotsam;

beforeAll(async () => {
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ Hex } = await import('../core/hex.js'));
    ({ RiverDrift } = await import('../systems/riverDrift.js'));
    ({ RiverFlotsam } = await import('../systems/riverFlotsam.js'));
}, 120000);

let baseCfg;
beforeEach(() => {
    if (!baseCfg) baseCfg = DataLoader._gamedata.riverDrift;
    DataLoader._gamedata.riverDrift = baseCfg;
});

const withFlotsam = (over) => {
    DataLoader._gamedata.riverDrift = { ...baseCfg, flotsam: { ...baseCfg.flotsam, ...over } };
};

/**
 * A 30×12 world, land but for a river along row 6 running west from q=25 to
 * q=3 and the sea at q ≤ 2; `extra` by 'q,r' laid on hexes.
 */
function riverWorld({ seed = 31, season = 'Summer', extra = {} } = {}) {
    const tiles = new Map();
    const at = (q, r) => {
        const k = `${q},${r}`;
        if (!tiles.has(k)) {
            const sea = q <= 2;
            const t = { q, r, terrain: { id: sea ? 'ocean' : 'grassland' }, elevation: 0.5 };
            if (r === 6 && q >= 3 && q <= 25) { t.hasRiver = true; t.riverDir = 3; }
            if (extra[k]) Object.assign(t, extra[k]);
            tiles.set(k, t);
        }
        return tiles.get(k);
    };
    return {
        day: 10, season, width: 30, height: 12, generationParams: { seed, terrainGen: 3 },
        getTile: (q, r) => (r < 0 || r >= 12 ? null : at(((q % 30) + 30) % 30, r)),
    };
}

describe('the rivers bring things down on their own', () => {
    it('the day\'s finds go in along the rivers, the same for the same world', () => {
        const a = riverWorld(), b = riverWorld();
        const ia = RiverFlotsam.spawnDay(a, 10), ib = RiverFlotsam.spawnDay(b, 10);
        expect(ia.length).toBeGreaterThan(0);
        expect(ia.map(it => [it.itemId, it.q, it.r, it.qty])).toEqual(ib.map(it => [it.itemId, it.q, it.r, it.qty]));
        for (const it of ia) {
            expect(it.wild).toBe(true);
            expect(RiverDrift.isRiverHex(a.getTile(it.q, it.r))).toBe(true);
            expect((DataLoader._gamedata.playerEconomy.GOODS || {})[it.itemId.toUpperCase()], it.itemId).toBeTruthy();
        }
        // once a day only
        expect(RiverFlotsam.spawnDay(a, 10)).toEqual([]);
        // another seed, another river's worth
        const c = riverWorld({ seed: 99 });
        const ic = RiverFlotsam.spawnDay(c, 10);
        expect(ic.map(it => [it.itemId, it.q]).join()).not.toBe(ia.map(it => [it.itemId, it.q]).join());
    });

    it('the lower reaches carry more, having gathered more river', () => {
        const w = riverWorld();
        const rv = RiverFlotsam.rivers(w, 0);
        const head = rv.list.find(e => e.q === 25), foot = rv.list.find(e => e.q === 3);
        expect(foot.up).toBe(22);
        expect(head.up).toBe(0);
        expect(foot.w).toBeGreaterThan(head.w * 3);
    });

    it('then flow down like anything thrown in, and are lost at sea', () => {
        const w = riverWorld();
        RiverFlotsam.spawnDay(w, 10);
        expect(RiverDrift.state(w).items.length).toBeGreaterThan(0);
        RiverDrift.advance(w, 10 * 24 + 24 * 3);
        expect(RiverDrift.state(w).items.length).toBe(0);
    });

    it('more in the spring floods than in winter; never past maxWild', () => {
        const count = (season) => {
            const w = riverWorld({ season });
            let n = 0;
            for (let d = 0; d < 40; d++) n += RiverFlotsam.spawnDay(w, d).length;
            return n;
        };
        expect(count('Spring')).toBeGreaterThan(count('Winter') * 2.5);
        withFlotsam({ maxWild: 10, perDay: 6 });
        const w = riverWorld();
        // (nothing carried off: a lake-less, sea-less run of days held still)
        for (let d = 0; d < 20; d++) RiverFlotsam.spawnDay(w, d);
        expect(RiverDrift.state(w).items.filter(it => it.wild).length).toBeLessThanOrEqual(10);
    });

    it('the things people lose turn up mostly near towns; in rain and storm, more of the woods', () => {
        const human = (ctx) => {
            let h = 0;
            for (let i = 0; i < 2000; i++) if (RiverFlotsam.pick((i + 0.5) / 2000, ctx).kind === 'human') h++;
            return h / 2000;
        };
        expect(human({ town: true })).toBeGreaterThan(human({ town: false }) * 1.8);
        expect(human({ town: false, wet: 2.5 })).toBeLessThan(human({ town: false }));
    });

    it('a watched hex has things come down into it from upstream, now and then', () => {
        const w = riverWorld();
        const q = 12, r = 6;
        const came = [];
        for (let h = 0; h < 72; h++) {
            const it = RiverFlotsam.watch(w, q, r, 240 + h + 0.5);
            if (it) came.push(it);
        }
        expect(came.length).toBeGreaterThan(8);
        expect(came.length).toBeLessThan(50);
        for (const it of came) {
            expect(it.q).toBe(q);
            expect(it.inDir).toBe(0); // the river comes in from the east
            expect(it.state).toBe('drift');
        }
        // (an hour counted once)
        expect(RiverFlotsam.watch(w, q, r, 240 + 71.9)).toBeNull();
    });

    it('a purse holds coin; a bottle a note', () => {
        const fl = RiverFlotsam.config();
        const purse = fl.finds.find(f => f.coins), bottle = fl.finds.find(f => f.note);
        const p = RiverFlotsam.make(purse, 'k1'), b = RiverFlotsam.make(bottle, 'k2');
        expect(p.coins).toBeGreaterThanOrEqual(purse.coins[0]);
        const player = { gold: 5, inventory: {}, q: 5, r: 6 };
        const w = riverWorld();
        const got = RiverFlotsam.receive(w, player, p);
        expect(got.ok).toBe(true);
        expect(player.gold).toBe(5 + p.coins);
        expect(player.inventory[purse.item]).toBe(1);
        const read = RiverFlotsam.receive(w, player, b);
        expect(typeof read.note).toBe('string');
        expect(read.note.length).toBeGreaterThan(10);
    });

    it('the new goods are real goods with pictures', async () => {
        const { itemSpriteSource } = await import('../ui/itemSprites.js');
        const goods = DataLoader._gamedata.playerEconomy.GOODS;
        for (const id of ['sticks', 'driftwood', 'reeds', 'fishing_net']) {
            expect(goods[id.toUpperCase()], id).toBeTruthy();
            expect(itemSpriteSource(id).src).toBe('assets/items/goods/goods.png');
        }
        for (const id of ['message_bottle', 'coin_purse']) expect(itemSpriteSource(id).src).toBe('assets/items/goods/goods.png');
        expect(Hex).toBeTruthy();
    });
});
