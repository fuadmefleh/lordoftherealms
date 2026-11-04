/**
 * Found Colony is offered out in the wilds — greyed with the reason when you
 * can't yet (player/actions/wildernessActions.js; ui/actionMenu/core.js).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

describe('Found Colony in the action menu', () => {
    it('shows with why when too poor or too near a town, and can be pressed when all is well', async () => {
        const { newGame } = await import('./playtest/harness.js');
        const { PlayerActions } = await import('../player/playerActions.js');
        const { Colonization } = await import('../world/colonization.js');
        const { Hex } = await import('../core/hex.js');
        const game = newGame(4242, { kingdomCount: 3 });
        const { world, player } = game;
        const towns = world.getSettlementViews();
        let near = null, far = null;
        for (let q = 0; q < world.width && !(near && far); q++) {
            for (let r = 0; r < world.height && !(near && far); r++) {
                const t = world.getTile(q, r);
                if (!t || t.settlement || !t.terrain.passable || t.playerProperty) continue;
                const d = Math.min(...towns.map(s => Hex.wrappingDistance(q, r, s.q, s.r, world.width)));
                if (!near && d < Colonization.MIN_SETTLEMENT_DISTANCE) near = t;
                if (!far && d >= Colonization.MIN_SETTLEMENT_DISTANCE + 1) far = t;
            }
        }
        const offer = (t) => {
            player.q = t.q; player.r = t.r;
            return PlayerActions.getAvailableActions(player, t, world).find(a => a.type === 'found_colony');
        };
        player.gold = 10;
        const poor = offer(far);
        expect(poor && poor.disabled).toBe(true);
        expect(poor.reason).toMatch(/gold/);
        player.gold = 5000;
        const close = offer(near);
        expect(close.disabled).toBe(true);
        expect(close.reason).toMatch(/Too close.*hexes/);
        const ok = offer(far);
        expect(ok.disabled).toBe(false);
        // the menu draws a disabled one greyed, unpressable, with its reason
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const html = ActionMenu._renderActionTile(close);
        expect(html).toMatch(/disabled/);
        expect(html).toMatch(/Too close/);
    });
});
