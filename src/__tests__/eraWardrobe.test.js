// What people wear in each era (world/eraWardrobe.js, data/eras.json): the
// world's year picks the era; a look's layers are fitted to it — hides and
// flint at the Dawn, no plate before the high kingdoms — deterministically
// per wearer, and the mature world (the default 853) is today's wardrobe.

import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { EraWardrobe } from '../world/eraWardrobe.js';
import { Utils } from '../core/utils.js';
import {
    defaultAppearance, appearanceLayers, cycleOption, eraMisfits, fitAppearanceToYear, optionFitsEra, randomAppearance,
} from '../ui/playerAppearance.js';

const ROOT = path.resolve(__dirname, '../..');
const ERAS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/eras.json'), 'utf8'));
const RENDER = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/innerMapRenderer.json'), 'utf8'));
const MIL = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/military.json'), 'utf8'));
const CHARS = path.join(ROOT, 'assets/lpc/Characters');

const MODERN_GUARD = [
    'Props/Sword 01 - Arming Sword/_Behind/Steel',
    'Props/Shield 01 - Heater Shield/Wood/Oak/_Behind',
    'Props/Shield 01 - Heater Shield/Trim/Steel/_Behind',
    'Body/Body 02 - Masculine, Thin/Peach',
    'Head/Head 02 - Masculine/Peach',
    'Clothing/Masculine, Thin/Legs/Pants 04 - Cuffed Pants/Cyan',
    'Clothing/Masculine, Thin/Feet/Shoes 02 - Boots/Black',
    'Clothing/Masculine, Thin/Torso/Shirt 07 - Buttoned Longsleeve Shirt/Wine',
    'Clothing/Masculine, Thin/Armour/Plate',
    'Clothing/Masculine, Thin/Armour/Tabard/Wine',
    'Hair/Short 01 - Buzzcut/Brown',
    'Head Accessories/Helm 02 - Bascinet, Closed/Steel',
    'Head Accessories/Helm Accessory 01 - Bascinet Plumage/Red',
    'Props/Shield 01 - Heater Shield/Wood/Oak',
    'Props/Shield 01 - Heater Shield/Paint/Red',
    'Props/Shield 01 - Heater Shield/Trim/Steel',
    'Props/Sword 01 - Arming Sword/Steel',
];

const METAL = /^(Props|Head Accessories)\/.*\/(Iron|Steel|Brass|Gold|Silver|Copper)$|^Clothing\/[^/]+\/Armour\/(Mail|Plate|Brigandine|Tabard)|^Head Accessories\/Helm/;

/** Every look the game draws from data: the NPC presets and the battle recipes (filled). */
function allRecipes() {
    const fill = { skin: 'Tan', hair: 'Short 01 - Buzzcut/Brown', shirt: 'Teal', legs: 'Charcoal', paint: 'Cyan', plume: 'White' };
    const out = Object.entries(RENDER.characterPresets).filter(([k]) => !k.startsWith('_')).map(([, v]) => v.layers);
    for (const r of Object.values(MIL.battlefield.looks.recipes)) {
        out.push(r.map(l => l.replace(/\{(\w+)\}/g, (_, k) => fill[k] || '')));
    }
    return [...out, MODERN_GUARD];
}

describe('EraWardrobe', () => {
    it('the year picks the era', () => {
        expect(EraWardrobe.eraIdOf(1, ERAS)).toBe('dawn');
        expect(EraWardrobe.eraIdOf(199, ERAS)).toBe('dawn');
        expect(EraWardrobe.eraIdOf(200, ERAS)).toBe('early');
        expect(EraWardrobe.eraIdOf(350, ERAS)).toBe('early');
        expect(EraWardrobe.eraIdOf(500, ERAS)).toBe('high');
        expect(EraWardrobe.eraIdOf(749, ERAS)).toBe('high');
        expect(EraWardrobe.eraIdOf(750, ERAS)).toBe('late');
        expect(EraWardrobe.eraIdOf(853, ERAS)).toBe('late');
        expect(EraWardrobe.eraIdOf(1400, ERAS)).toBe('late');
        expect(EraWardrobe.eraIdOf(undefined, ERAS)).toBe('late');
    });

    it('the mature world (the default 853) wears every look exactly as it is', () => {
        for (const layers of allRecipes()) {
            expect(EraWardrobe.fitForYear(layers, 853, 7, ERAS)).toBe(layers);
        }
        expect(EraWardrobe.isModern(EraWardrobe.eraOf(853, ERAS))).toBe(true);
    });

    it('no metal and no shields at the Dawn: hides, bare feet, flint and wood', () => {
        for (const layers of allRecipes()) {
            for (let seed = 0; seed < 12; seed++) {
                const out = EraWardrobe.fitForYear(layers, 100, seed, ERAS);
                for (const l of out) {
                    expect(l).not.toMatch(METAL);
                    expect(l).not.toMatch(/^Props\/Shield |\/Feet\/|^Props\/(Sword|Crossbow|Pike|Halberd|Bill|Dane Axe)\//);
                }
                const cloth = out.filter(l => /^Clothing\/[^/]+\/(Torso|Legs)\//.test(l));
                for (const l of cloth) expect(['Leather', 'Brown', 'Umber', 'Sepia', 'Chocolate', 'Coffee']).toContain(l.split('/').pop());
            }
        }
    });

    it('no plate, coat of plates or late helms before the high kingdoms; plate only on a few there', () => {
        for (const layers of allRecipes()) {
            for (let seed = 0; seed < 12; seed++) {
                const early = EraWardrobe.fitForYear(layers, 350, seed, ERAS);
                for (const l of early) {
                    expect(l).not.toMatch(/Armour\/(Plate|Brigandine|Tabard)|Bascinet|Kettle|Morion|Heater|Crossbow|Halberd|\/Steel$/);
                    expect(l).not.toMatch(/Shirt 0[789]|Pants 0[45]|Torso 2/);
                }
                const high = EraWardrobe.fitForYear(layers, 600, seed, ERAS);
                for (const l of high) expect(l).not.toMatch(/Armour\/Brigandine|Bascinet, Closed|Morion|Pavise|Halberd/);
            }
        }
        let plate = 0;
        for (let seed = 0; seed < 60; seed++) {
            if (EraWardrobe.fitForYear(MODERN_GUARD, 600, seed, ERAS).some(l => /Armour\/Plate$/.test(l))) plate++;
        }
        expect(plate).toBeGreaterThan(0);
        expect(plate).toBeLessThan(40);
    });

    it('maps a modern outfit to its era substitutes', () => {
        const early = EraWardrobe.fitForYear(MODERN_GUARD, 350, 3, ERAS);
        expect(early).toContain('Clothing/Masculine, Thin/Torso/Shirt 01 - Longsleeve Shirt/Wine');
        expect(early).toContain('Clothing/Masculine, Thin/Legs/Pants 03 - Pants/' + early.find(l => /Pants 03/.test(l)).split('/').pop());
        expect(early).toContain('Clothing/Masculine, Thin/Armour/Mail');
        expect(early).toContain('Head Accessories/Helm 03 - Norman/Iron');
        expect(early).toContain('Props/Shield 03 - Round Shield/Base');
        expect(early).toContain('Props/Shield 03 - Round Shield/Paint/Red');
        expect(early).toContain('Props/Sword 01 - Arming Sword/Iron');
        // (a Cyan dye is not of the early kingdoms)
        expect(early.some(l => l.endsWith('/Cyan'))).toBe(false);
    });

    it('a wearer keeps their look; weapon back and front stay one weapon', () => {
        for (let seed = 0; seed < 30; seed++) {
            const a = EraWardrobe.fitForYear(MODERN_GUARD, 120, `npc${seed}`, ERAS);
            expect(EraWardrobe.fitForYear(MODERN_GUARD, 120, `npc${seed}`, ERAS)).toEqual(a);
            const props = a.filter(l => l.startsWith('Props/')).map(l => l.split('/')[1]);
            expect(new Set(props).size).toBe(1);
            expect(a.length).toBe(new Set(a).size);
        }
        // ...and different wearers do not all look the same
        const looks = new Set();
        for (let seed = 0; seed < 30; seed++) looks.add(EraWardrobe.fitForYear(MODERN_GUARD, 120, seed, ERAS).join('|'));
        expect(looks.size).toBeGreaterThan(1);
    });

    it('draws no RNG', () => {
        Utils.setSeed(5);
        const before = Utils.random();
        Utils.setSeed(5);
        EraWardrobe.fitForYear(MODERN_GUARD, 100, 1, ERAS);
        EraWardrobe.fitForYear(MODERN_GUARD, 350, 1, ERAS);
        expect(Utils.random()).toBe(before);
    });

    it('every layer any era makes is an asset in the repo', () => {
        const missing = new Set();
        for (const year of [100, 350, 600]) {
            for (const layers of allRecipes()) {
                for (let seed = 0; seed < 9; seed++) {
                    for (const l of EraWardrobe.fitForYear(layers, year, seed, ERAS)) {
                        const dir = path.join(CHARS, l);
                        const ok = fs.existsSync(path.join(dir, 'Walk.png')) || fs.existsSync(path.join(dir, 'Combat 1h - Idle.png'));
                        if (!ok) missing.add(l);
                    }
                }
            }
        }
        expect([...missing]).toEqual([]);
    });
});

describe('the character creator dresses for its start year', () => {
    it('the default look fits the mature world and is unchanged there', () => {
        const look = defaultAppearance('male');
        expect(eraMisfits(look, 853, ERAS)).toEqual([]);
        expect(fitAppearanceToYear(look, 853, ERAS)).toBe(look);
    });

    it('a look out of its time is fitted to the era', () => {
        const look = { ...defaultAppearance('male'), shirt: 'Shirt 09 - Polo', shirtColor: 'Teal', legs: 'Pants 05 - Overalls' };
        expect(eraMisfits(look, 350, ERAS).sort()).toEqual(['legs', 'shirt']);
        const early = fitAppearanceToYear(look, 350, ERAS);
        expect(eraMisfits(early, 350, ERAS)).toEqual([]);
        const dawn = fitAppearanceToYear(look, 100, ERAS);
        expect(eraMisfits(dawn, 100, ERAS)).toEqual([]);
        // the Dawn's fitted look keeps through the wardrobe unchanged
        const layers = appearanceLayers(dawn);
        expect(EraWardrobe.fitForYear(layers, 100, 0, ERAS)).toEqual(layers);
    });

    it('cycling offers only the era\'s choices; the random look is of its time', () => {
        let look = fitAppearanceToYear(defaultAppearance('female'), 100, ERAS);
        const seen = new Set();
        for (let i = 0; i < 12; i++) {
            look = cycleOption(look, 'shirt', 1, 100, ERAS);
            seen.add(look.shirt);
            expect(optionFitsEra(look, 'shirt', look.shirt, 100, ERAS)).toBe(true);
        }
        expect(seen.size).toBeGreaterThan(1);
        let n = 0;
        const rand = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
        for (let i = 0; i < 20; i++) expect(eraMisfits(randomAppearance('male', rand, 100, ERAS), 100, ERAS)).toEqual([]);
    });
});
