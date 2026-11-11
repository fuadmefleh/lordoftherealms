// "Keep the clan in step" (world/dawn.js keepStep, player.dawnInStep): at the
// Dawn of Man the player's clan walks with them hex for hex instead of
// trailing behind; where it can't follow (another landmass, impassable,
// aboard ship) it waits and falls in again when the player is beside it.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Dawn } from '../world/dawn.js';
import { Hex } from '../core/hex.js';
import { PlayerActions } from '../player/actions/index.js';

beforeAll(async () => {
    await loadData();
});

function dawnGame() {
    const game = newGame(808, { startYear: 1, terrainGen: 3, kingdomCount: 3 });
    const clan = Dawn.kinClan(game.world, game.player);
    return { ...game, clan };
}

/** A passable neighbour of (q, r) on the same land. */
function landStep(world, q, r) {
    const here = world.getTile(q, r);
    for (const n of Hex.neighbors(q, r)) {
        const t = world.getTile(Hex.wrapQ(n.q, world.width), n.r);
        if (t && t.terrain && t.terrain.passable && t.regionId === here.regionId && !t.settlement) return { q: Hex.wrapQ(n.q, world.width), r: n.r };
    }
    return null;
}

/** Move the player one hex as a step does (prev → next), then let the clan keep step. */
function step(world, player, to) {
    player.prevQ = player.q; player.prevR = player.r;
    player.q = to.q; player.r = to.r;
    return Dawn.keepStep(world, player);
}

describe('the clan in step', () => {
    it('offers the toggle while the clan wanders with you', () => {
        const { player, world, clan } = dawnGame();
        expect(clan).toBeTruthy();
        const acts = PlayerActions.getAvailableActions(player, world.getTile(player.q, player.r), world);
        const t = acts.find(a => a.type === 'dawn_instep');
        expect(t).toBeTruthy();
        expect(t.label).toMatch(/Keep the clan in step/);
        player.dawnInStep = true;
        const again = PlayerActions.getAvailableActions(player, world.getTile(player.q, player.r), world).find(a => a.type === 'dawn_instep');
        expect(again.label).toMatch(/own pace/);
    });

    it('in step, the clan walks onto each hex you step to; out of step it stays', () => {
        const { player, world, clan } = dawnGame();
        const a = landStep(world, player.q, player.r);
        expect(a).toBeTruthy();
        // out of step: no move
        expect(step(world, player, a)).toBe(false);
        expect([clan.q, clan.r]).not.toEqual([a.q, a.r]);
        // back beside it, in step: it walks with you
        clan.q = player.prevQ; clan.r = player.prevR;
        player.dawnInStep = true;
        const b = landStep(world, a.q, a.r);
        player.q = a.q; player.r = a.r;
        expect(step(world, player, b)).toBe(true);
        expect([clan.q, clan.r]).toEqual([b.q, b.r]);
        const c = landStep(world, b.q, b.r);
        expect(step(world, player, c)).toBe(true);
        expect([clan.q, clan.r]).toEqual([c.q, c.r]);
    });

    it('it waits where it cannot follow: far off, aboard ship', () => {
        const { player, world, clan } = dawnGame();
        player.dawnInStep = true;
        const a = landStep(world, player.q, player.r);
        // left far behind: no teleport
        clan.q = Hex.wrapQ(player.q + 6, world.width);
        clan.r = player.r;
        expect(step(world, player, a)).toBe(false);
        // aboard a ship: they stay ashore
        clan.q = player.q; clan.r = player.r;
        player.boardedShip = { id: 'x' };
        expect(step(world, player, landStep(world, a.q, a.r))).toBe(false);
    });
});
