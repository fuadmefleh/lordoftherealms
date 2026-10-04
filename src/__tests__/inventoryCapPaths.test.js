// Every path that hands the player new goods goes through the capped
// PlayerInventory.addItem — no UI or system code bumps player.inventory directly.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PlayerInventory, BASE_INVENTORY_SLOTS } from '../player/inventory.js';
import { Ships } from '../systems/ships.js';

const SRC = path.resolve(__dirname, '..');

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
    }
    return out;
}

/** A pack with every slot filled by distinct goods. */
function fullPlayer() {
    const inventory = {};
    for (let i = 0; i < BASE_INVENTORY_SLOTS; i++) inventory[`good_${i}`] = 1;
    return { inventory, houses: [], gold: 0 };
}

describe('inventory cap is respected by every gain path', () => {
    it('no code outside core/inventory.js adds to player.inventory directly', () => {
        // `player.inventory[x] = (player.inventory[x] || 0) + n` and `player.inventory.x += n`
        const additive = /player\.inventory(\[[^\]]+\]|\.\w+)\s*(=\s*\(\s*[\w.]*player\.inventory[^)]*\|\|\s*0\)\s*\+|\+=)/;
        const offenders = [];
        for (const file of walk(SRC)) {
            if (file.endsWith(path.join('core', 'inventory.js'))) continue;
            const lines = fs.readFileSync(file, 'utf8').split('\n');
            lines.forEach((line, i) => {
                if (additive.test(line)) offenders.push(`${path.relative(SRC, file)}:${i + 1}: ${line.trim()}`);
            });
        }
        // Tan Leather restores the hides it took when the armor doesn't fit — not a gain
        const allowed = offenders.filter(o => !/inventory\.leather \+= 2/.test(o));
        expect(allowed).toEqual([]);
    });

    it('the routed UI paths call PlayerInventory.addItem', () => {
        const uses = (rel, re) => expect(fs.readFileSync(path.join(SRC, rel), 'utf8')).toMatch(re);
        uses('ui/actionMenu/build.js', /PlayerInventory\.addItem\(player, reward\.id/);
        uses('ui/actionMenu/build.js', /PlayerInventory\.addItem\(game\.player, 'wood'/);
        uses('ui/actionMenu/build.js', /PlayerInventory\.addItem\(game\.player, 'stone'/);
        uses('ui/actionMenu/jobs.js', /forageAdd = PlayerInventory\.addItem/);
        uses('ui/actionMenu/jobs.js', /huntAdd = PlayerInventory\.addItem/);
        uses('ui/actionMenu/skills.js', /PlayerInventory\.addItem\(player, 'horse'/);
        uses('ui/actionMenu/skills.js', /PlayerInventory\.addItem\(player, 'cooked_fish'/);
        uses('ui/actionMenu/skills.js', /PlayerInventory\.addItem\(player, 'cooked_meat'/);
        uses('ui/objectActions/actions.js', /PlayerInventory\.addItem\(game\.player, 'leather_armor'/);
        uses('ui/objectActions/logic.js', /PlayerInventory\.addItem\(game\.player, 'fish'/);
        uses('ui/game/gameLoop.js', /PlayerInventory\.addItem\(this\.player, resType/);
    });

    it('a full pack refuses new goods with a clear message but tops up held stacks', () => {
        const p = fullPlayer();
        const r = PlayerInventory.addItem(p, 'wood', 10);
        expect(r.success).toBe(false);
        expect(r.reason).toMatch(/packs are full/i);
        expect(p.inventory.wood).toBeUndefined();
        expect(PlayerInventory.addItem(p, 'good_0', 4)).toMatchObject({ success: true, added: 4 });
        expect(p.inventory.good_0).toBe(5);
    });

    it('ship unloading leaves new goods aboard when the packs are full', () => {
        const p = fullPlayer();
        const ship = { cargo: { stone: 5, good_1: 3 } };
        const res = Ships.unloadCargo(ship, p);
        expect(res.packsFull).toBe(true);
        expect(res.leftAboard).toEqual({ stone: 5 });
        expect(p.inventory.stone).toBeUndefined();
        expect(p.inventory.good_1).toBe(4);
        expect(ship.cargo).toEqual({ stone: 5 });
    });
});
