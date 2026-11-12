// Heirlooms: named things of the House — made, found or forged by deeds;
// their legend grows with what is done with them in hand; they pass to the
// heir, can be pawned, stolen, lost and given in dowry, and recovered.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Relationships } from '../systems/relationships.js';
import { House } from '../systems/house.js';
import { Heirlooms } from '../systems/heirlooms.js';
import { TreasureDigs } from '../systems/treasureDigs.js';
import { Grades } from '../core/grades.js';
import { PlayerEffects } from '../player/playerEffects.js';

beforeAll(async () => {
    await loadData();
});

function townTile(game) {
    const s = game.world.getSettlementViews()[0];
    return game.world.getTile(s.q, s.r);
}

describe('Heirlooms', () => {
    it('a new heirloom has a name, a first line, and a bonus that grows with its legend (capped)', () => {
        const game = newGame(201);
        const h = Heirlooms.create(game.player, game.world, { kind: 'sword', origin: 'deed', text: 'Forged for {ruler}' });
        expect(h.name.length).toBeGreaterThan(2);
        expect(h.history[0].text).toContain(game.player.name);
        expect(h.status).toBe('held');
        const before = Heirlooms.bonusOf(h).battlePower;
        for (let i = 0; i < 10; i++) Heirlooms.addLine(h, game.world, `Deed ${i}`, 3);
        expect(Heirlooms.bonusOf(h).battlePower).toBeGreaterThan(before);
        expect(Heirlooms.tier(h).label).toBe('Legendary');
        for (let i = 0; i < 40; i++) Heirlooms.create(game.player, game.world, { kind: 'sword' });
        expect(Heirlooms.bonus(game.player, 'battlePower')).toBeLessThanOrEqual(Heirlooms.config().caps.battlePower + 1e-9);
        // PlayerEffects reads it
        expect(PlayerEffects.treasureBonus(game.player, 'battlePower')).toBeGreaterThanOrEqual(Heirlooms.bonus(game.player, 'battlePower'));
    });

    it('battles in the Prestige log become lines; a fifth victory forges a banner', () => {
        const game = newGame(202);
        const p = game.player;
        const ring = Heirlooms.create(p, game.world, { kind: 'ring' });
        Heirlooms.processDay(p, game.world); // first look: cursors only
        game.world.day += 1;
        House.recordPlayerDeed(p, game.world, 'battleWon', { reason: 'broke a Vael army in the field' });
        p.house.stats.battleWon = 5;
        const res = Heirlooms.processDay(p, game.world);
        expect(ring.history.some(l => /broke a Vael army/.test(l.text))).toBe(true);
        expect(Heirlooms.list(p).some(h => h.kind === 'banner')).toBe(true);
        expect(res.notices.length).toBeGreaterThan(0);
        // not counted twice
        const n = ring.history.length;
        game.world.day += 1;
        Heirlooms.processDay(p, game.world);
        expect(ring.history.length).toBe(n);
    });

    it('a treasure cache dug up whole may hold an heirloom (finds.digChance)', () => {
        const game = newGame(41);
        const { player, world } = game;
        const C = Heirlooms.config();
        const was = C.finds.digChance;
        const tile = world.getTile(player.q, player.r);
        try {
            C.finds.digChance = 1;
            tile.buried = { gold: 10, items: [], discovered: false };
            const res = TreasureDigs.giveLoot(player, world, tile, 1);
            expect(res.heirloom).toBeTruthy();
            expect(Heirlooms.list(player).some(h => h.id === res.heirloom.id && h.origin === 'found')).toBe(true);
            C.finds.digChance = 0;
            tile.buried = { gold: 10, items: [], discovered: false };
            expect(TreasureDigs.giveLoot(player, world, tile, 1).heirloom).toBe(null);
        } finally {
            C.finds.digChance = was;
            tile.buried = null;
        }
    });

    it('a masterwork in the packs becomes an heirloom', () => {
        const game = newGame(203);
        const p = game.player;
        p.inventory.steel_sword = 1;
        Grades.add(p, 'steel_sword', 1, 'masterwork');
        expect(Heirlooms.eligible(p).map(e => e.itemId)).toContain('steel_sword');
        const r = Heirlooms.forgeFromItem(p, game.world, 'steel_sword');
        expect(r.success).toBe(true);
        expect(r.item.kind).toBe('sword');
        expect(p.inventory.steel_sword || 0).toBe(0);
        // a common one does not qualify
        p.inventory.steel_sword = 1;
        expect(Heirlooms.eligible(p).some(e => e.itemId === 'steel_sword')).toBe(false);
    });

    it('passes to the heir at a succession, with its line and its new bearer', () => {
        const game = newGame(204);
        const p = game.player;
        game.world.day = 3000;
        const ring = Heirlooms.create(p, game.world, { kind: 'ring' });
        const c = Relationships.generateChild(p, { culture: p.culture }, game.world, { quiet: true });
        c.age = 20;
        const oldName = p.name;
        const r = Relationships.succeedAsHeir(p, c.id, game.world, { cause: 'old age' });
        expect(r.success).toBe(true);
        expect(ring.status).toBe('held');
        expect(ring.history.some(l => l.text.includes(`death of ${oldName}`))).toBe(true);
        expect(ring.bearers[ring.bearers.length - 1].id).toBe(c.id);
        expect(ring.bearers[0].to).not.toBeNull();
        // the heir's fresh packs did not lose it
        expect(Heirlooms.held(p)).toContain(ring);
    });

    it('pawned, forfeit and sold away, then bought back where it surfaced', () => {
        const game = newGame(205);
        const p = game.player;
        const t = townTile(game);
        p.q = t.q; p.r = t.r;
        const h = Heirlooms.create(p, game.world, { kind: 'book' });
        const gold0 = p.gold;
        const r = Heirlooms.pawn(p, game.world, h.id);
        expect(r.success).toBe(true);
        expect(p.gold).toBe(gold0 + r.gold);
        expect(Heirlooms.bonus(p, 'negotiation')).toBe(0);
        game.world.day = h.pawn.due + 1;
        Heirlooms.processDay(p, game.world); // cursors
        Heirlooms.processDay(p, game.world);
        expect(h.status).toBe('sold');
        expect(h.trail && h.trail.place).toBeTruthy();
        const far = Heirlooms.recover(p, game.world, h.id, 'buy');
        if (p.q !== h.trail.q || p.r !== h.trail.r) expect(far.success).toBe(false);
        p.q = h.trail.q; p.r = h.trail.r;
        p.gold = 100000;
        const back = Heirlooms.recover(p, game.world, h.id, 'buy');
        expect(back.success).toBe(true);
        expect(h.status).toBe('held');
        expect(h.history.some(l => /Recovered/.test(l.text))).toBe(true);
    });

    it('sent as dowry with a child wed into a realm, and asked back', () => {
        const game = newGame(206);
        const p = game.player;
        const k = game.world.kingdoms[0];
        const c = Relationships.generateChild(p, { culture: p.culture }, game.world, { quiet: true });
        c.age = 18;
        c.upbringing = c.upbringing || {};
        c.upbringing.spouse = { kind: 'alliance', kingdomId: k.id, kingdomName: k.name, name: 'Ada of There', day: 1 };
        const h = Heirlooms.create(p, game.world, { kind: 'ring' });
        const rep0 = (p.reputation && p.reputation[k.id]) || 0;
        const r = Heirlooms.giveAsDowry(p, game.world, h.id, c.id);
        expect(r.success).toBe(true);
        expect(h.status).toBe('dowry');
        expect(p.reputation[k.id]).toBeGreaterThan(rep0);
        const o = Heirlooms.recoverOptions(p, game.world, h.id);
        expect(o.ask).toBeTruthy();
        if (h.trail.q != null) {
            p.q = h.trail.q; p.r = h.trail.r;
            p.reputation[k.id] = 100;
            expect(Heirlooms.recover(p, game.world, h.id, 'ask').success).toBe(true);
            expect(h.status).toBe('held');
        }
    });

    it('a child who dies holding one gives it back to the House; heirlooms save with the House', () => {
        const game = newGame(207);
        const p = game.player;
        const c = Relationships.generateChild(p, { culture: p.culture }, game.world, { quiet: true });
        const h = Heirlooms.create(p, game.world, { kind: 'banner' });
        expect(Heirlooms.give(p, game.world, h.id, c.id).success).toBe(true);
        expect(h.status).toBe('child');
        c.isAlive = false;
        Heirlooms.processDay(p, game.world);
        expect(h.status).toBe('held');
        const p2 = { ...p };
        House.deserialize(p2, game.world, House.serialize(p.house));
        expect(Heirlooms.list(p2).map(x => x.name)).toEqual(Heirlooms.list(p).map(x => x.name));
    });

    it('is deterministic for a world and day, and never draws the shared stream', async () => {
        const { Utils } = await import('../core/utils.js');
        const a = newGame(208);
        const b = newGame(208);
        Utils.setSeed(5);
        const before = Utils.random();
        Utils.setSeed(5);
        const ha = Heirlooms.create(a.player, a.world, { kind: 'sword' });
        const hb = Heirlooms.create(b.player, b.world, { kind: 'sword' });
        expect(Utils.random()).toBe(before);
        expect(ha.name).toBe(hb.name);
    });
});
