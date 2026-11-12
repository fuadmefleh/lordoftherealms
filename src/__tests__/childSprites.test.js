/**
 * Children drawn as children (ui/innerMapCharacters.js child looks, ui/innerMapKin.js):
 * under childLooks.under a townsfolk child wears the LPC child body, head, pants or skirt,
 * shirt and hair (assets/lpc/Characters/Children), skin and hair colour from a parent;
 * the grown keep their adult presets.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

let InnerMap, DataLoader, Utils, InnerMapKin, InnerMapCharacters;
const CFG = JSON.parse(fs.readFileSync('data/innerMapRenderer.json', 'utf8'));
const ROOT = 'assets/lpc/Characters';

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ Utils } = await import('../core/utils.js'));
    ({ InnerMapKin } = await import('../ui/innerMapKin.js'));
    ({ InnerMapCharacters } = await import('../ui/innerMapCharacters.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
    InnerMapCharacters.configure(CFG);
}, 120000);

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    Utils.setSeed(5);
});

/** Every sheet the composer asks for, for these layers (the animations it requests of each). */
function requested(layers) {
    const IMC = InnerMapCharacters;
    const anims = ['Walk', 'Idle', 'Combat 1h - Slash', ...IMC._EXTRA_ANIMS.map(e => e.file)];
    const out = [];
    for (const l of layers) for (const a of anims) { const p = IMC._sheetPath(l, a); if (p) out.push(p); }
    return out;
}

const PNG_W = file => fs.readFileSync(file).readUInt32BE(16);
const PNG_H = file => fs.readFileSync(file).readUInt32BE(20);

describe('Child sprites: the assets', () => {
    const C = CFG.childLooks;

    it('every child layer the looks can name has walk, idle, sit and hurt sheets of the right size', () => {
        const dirs = [];
        for (const s of C.skins) dirs.push(`Children/Body/${s}`, `Children/Head/Head 01 - Default/${s}`);
        const bands = [...Object.values(C.wardrobe)];
        for (const ew of Object.values(C.eraWardrobe || {})) bands.push(...(Array.isArray(ew.shirts) ? [ew] : Object.values(ew)));
        for (const band of bands) {
            for (const c of band.shirts) dirs.push(`Children/Clothing/Shirt/${c}`);
            for (const c of band.pants) dirs.push(`Children/Clothing/Pants/${c}`);
            for (const c of band.skirts) dirs.push(`Children/Clothing/Skirt/${c}`);
        }
        const styles = [...C.hairStyles.male, ...C.hairStyles.female];
        for (const st of styles) for (const col of C.hairColours) dirs.push(`Children/Hair/${st}/${col}`);
        const paths = requested([...new Set(dirs)]);
        expect(paths.length).toBe(new Set(dirs).size * 4);
        for (const p of paths) {
            const f = path.join(p);
            expect(fs.existsSync(f), f).toBe(true);
            const w = PNG_W(f);
            // (the fall: six frames, one row facing the eye)
            if (p.endsWith('/hurt.png')) { expect(w, f).toBe(384); expect(PNG_H(f), f).toBe(64); continue; }
            expect(PNG_H(f), f).toBe(256);
            if (p.endsWith('/walk.png')) expect(w, f).toBe(512);
            else if (p.endsWith('/sit.png')) expect(w, f).toBe(192);
            else expect(w, f).toBe(64);   // the standing frame, held across the idle row
        }
    });

    it('child layers ask only for walk, idle and sit; adult layers keep their own names', () => {
        const IMC = InnerMapCharacters;
        expect(IMC._sheetPath('Children/Body/Peach', 'Walk')).toBe(`${ROOT}/Children/Body/Peach/walk.png`);
        expect(IMC._sheetPath('Children/Body/Peach', 'Sitting')).toBe(`${ROOT}/Children/Body/Peach/sit.png`);
        expect(IMC._sheetPath('Children/Body/Peach', 'Combat 1h - Slash')).toBe(null);
        expect(IMC._sheetPath('Body/Body 01 - Feminine, Thin/Peach', 'Walk')).toBe(`${ROOT}/Body/Body 01 - Feminine, Thin/Peach/Walk.png`);
        // The fall is the children's own: never fetched for a grown look
        expect(IMC._sheetPath('Children/Body/Peach', 'Hurt')).toBe(`${ROOT}/Children/Body/Peach/hurt.png`);
        expect(IMC._sheetPath('Body/Body 01 - Feminine, Thin/Peach', 'Hurt')).toBe(null);
    });

    it('a child look composites the fall; a grown look has none', async () => {
        const IMC = InnerMapCharacters;
        const look = IMC.childLook({ seed: 'hurt-1', gender: 'female' });
        const id = IMC.childPresetId(look);
        await IMC.ensureChild(id);
        expect(IMC.hasHurt(id)).toBe(true);
        expect(IMC.hasHurt('male_light_1')).toBe(false);
    });

    it('the credits name the generator and the artists', () => {
        const t = fs.readFileSync(`${ROOT}/Children/Credits.txt`, 'utf8');
        for (const who of ['Nila122', 'JaidynReiman', 'ElizaWy', 'Universal-LPC-Spritesheet-Character-Generator']) expect(t).toContain(who);
        expect(fs.existsSync(`${ROOT}/Children/CREDITS-ulpc-children.csv`)).toBe(true);
    });
});

describe('Child sprites: the looks', () => {
    it('a child look is all child layers; no adult preset has any', () => {
        const IMC = InnerMapCharacters;
        for (let i = 0; i < 40; i++) {
            const look = IMC.childLook({ seed: `s${i}`, gender: i % 2 ? 'female' : 'male', roles: [['noble', 'merchant', 'farmer'][i % 3]] });
            const layers = IMC.childLayers(look);
            expect(layers.every(l => l.startsWith('Children/'))).toBe(true);
            for (const p of requested(layers)) expect(fs.existsSync(p), p).toBe(true);
            expect(IMC.childLookOf(IMC.childPresetId(look))).toEqual(look);
        }
        for (const [id, pre] of Object.entries(CFG.characterPresets)) {
            if (id.startsWith('_')) continue;
            expect(pre.layers.some(l => l.startsWith('Children/')), id).toBe(false);
        }
    });

    it('skin and hair colour come from a parent; a greyed parent passes on their natural colour', () => {
        const IMC = InnerMapCharacters;
        // male_light_1: Ivory skin, Brown hair; female_bronze_1: Bronze skin, Black hair
        for (let i = 0; i < 20; i++) {
            const look = IMC.childLook({ seed: `k${i}`, parents: ['male_light_1', 'female_bronze_1'] });
            expect(['Ivory', 'Bronze']).toContain(look.skin);
            expect(['Brown', 'Black']).toContain(look.hair);
        }
        const one = IMC.childLook({ seed: 'x', parents: ['aged:White:male_light_1'] });
        expect(one.skin).toBe('Ivory');
        expect(one.hair).toBe('Brown');
        // siblings with no parent on the map share the household's colouring
        const a = IMC.childLook({ seed: 'a', family: 'hh7' }), b = IMC.childLook({ seed: 'b', family: 'hh7' });
        expect([a.skin, a.hair]).toEqual([b.skin, b.hair]);
    });

    it('a noble family dresses its children from the noble wardrobe', () => {
        const IMC = InnerMapCharacters;
        const W = CFG.childLooks.wardrobe.noble;
        for (let i = 0; i < 20; i++) {
            const look = IMC.childLook({ seed: `n${i}`, gender: 'female', roles: ['farmer', 'noble'] });
            expect(W.shirts).toContain(look.shirt);
            const [kind, col] = look.legs.split('/');
            expect(W[kind === 'Skirt' ? 'skirts' : 'pants']).toContain(col);
        }
    });

    it('an era before the mature world dresses children in its own cloth (the Dawn: earthy, undyed)', () => {
        const IMC = InnerMapCharacters;
        const dawn = CFG.childLooks.eraWardrobe.dawn;
        for (let i = 0; i < 40; i++) {
            const look = IMC.childLook({ seed: `dawn-${i}`, gender: i % 2 ? 'female' : 'male', roles: ['noble'], era: 'dawn' });
            expect(dawn.shirts).toContain(look.shirt);
            const [kind, col] = look.legs.split('/');
            expect(kind === 'Skirt' ? dawn.skirts : dawn.pants).toContain(col);
        }
        // The mature world keeps the plain wardrobe (a noble child's bright shirts among them)
        const late = new Set();
        for (let i = 0; i < 40; i++) late.add(IMC.childLook({ seed: `late-${i}`, roles: ['noble'], era: 'late' }).shirt);
        expect([...late].some(c => !dawn.shirts.includes(c))).toBe(true);
    });

    it('the era turning dresses a child afresh', () => {
        const IMC = InnerMapCharacters;
        const npc = { id: 901, uid: 'era-kid', type: 'child', gender: 'male', age: 7 };
        IMC.setYear(100);
        InnerMapKin._dressChild(npc, 7, null);
        expect(npc._childLookEra).toBe('dawn');
        expect(CFG.childLooks.eraWardrobe.dawn.shirts).toContain(IMC.childLookOf(npc._childLook).shirt);
        IMC.setYear(900);
        InnerMapKin._dressChild(npc, 7, null);
        expect(npc._childLookEra).toBe(IMC.eraId());
        IMC.setYear(null);
    });

    it('child sprites stop at childLooks.under and are drawn near their natural size', () => {
        const IMC = InnerMapCharacters;
        expect(IMC.isChildAge(5)).toBe(true);
        expect(IMC.isChildAge(CFG.childLooks.under)).toBe(false);
        expect(IMC.childScale(3)).toBeLessThan(IMC.childScale(12));
        expect(IMC.childScale(3)).toBeGreaterThan(0.8);
        expect(IMC.childScale(14)).toBe(null);
        expect(IMC.drawScale({ type: 'child', _scale: 0.95 })).toBe(0.95);
        expect(IMC.drawScale({ type: 'child' })).toBe(0.7);
        expect(IMC.drawScale({ type: 'villager' })).toBe(1);
    });

    it('a child look from a save is composited from its id when first drawn', async () => {
        const IMC = InnerMapCharacters;
        const id = IMC.childPresetId({ skin: 'Tan', hairStyle: 'Braid', hair: 'Raven', shirt: 'Green', legs: 'Skirt/Red' });
        IMC._composited.delete(id);
        delete IMC._presets[id];
        expect(IMC.drawCharacter({ drawImage() {} }, id, 'idle', 2, 0, 0, 0, 10, 10)).toBe(false);
        await new Promise(r => setTimeout(r, 30));
        expect(IMC._presets[id].layers).toEqual(IMC.childLayers(IMC.childLookOf(id)));
        expect(IMC.getComposited(id)).toBeTruthy();
        expect(IMC.getComposited(id).sitting).toBeTruthy();
        // A malformed id is left alone
        expect(IMC.childLookOf('child:Tan|Braid')).toBe(null);
    });

    it('a pupil\'s satchel: its own layer under the hair, in the id, with every sheet the children have', () => {
        const IMC = InnerMapCharacters;
        const plain = IMC.childPresetId({ skin: 'Tan', hairStyle: 'Braid', hair: 'Raven', shirt: 'Green', legs: 'Skirt/Red' });
        const bag = IMC.childWithSatchel(plain);
        expect(bag).toBe(`${plain}|bag:Brown`);
        expect(IMC.childWithSatchel(bag, null)).toBe(plain);
        expect(IMC.childLookOf(bag).bag).toBe('Brown');
        expect(IMC.childLookOf(plain).bag).toBeUndefined();
        const layers = IMC.childLayers(IMC.childLookOf(bag));
        expect(layers).toEqual([...IMC.childLayers(IMC.childLookOf(plain)).slice(0, 4), 'Children/Satchel/Brown', IMC.childLayers(IMC.childLookOf(plain))[4]]);
        for (const p of requested(['Children/Satchel/Brown'])) {
            expect(fs.existsSync(p), p).toBe(true);
            if (p.endsWith('/hurt.png')) { expect([PNG_W(p), PNG_H(p)]).toEqual([384, 64]); continue; }
            expect(PNG_H(p), p).toBe(256);
            expect(PNG_W(p), p).toBe(p.endsWith('/walk.png') ? 512 : p.endsWith('/sit.png') ? 192 : 64);
        }
        // (a malformed extra part is no bag)
        expect(IMC.childLookOf(`${plain}|nonsense`).bag).toBeUndefined();
    });
});

describe('Child sprites on the street map', () => {
    function enter(hour, day = 8) {
        const settlement = { name: 'Testby', type: 'city', population: 6000, q: 5, r: 6 };
        const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
        const world = {
            day, season: 'Spring', baseYear: 853, generationParams: { seed: 31 }, activeEvents: [],
            getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: () => null,
        };
        const game = { world, player: {}, settlement, ui: { showNotification() {} } };
        InnerMap.enter(game, 5, 6);
        InnerMap.timeOfDay = hour;
        return game;
    }

    it('young children wear child looks (hair from a parent on the map); youths and the grown do not', async () => {
        const game = enter(15, 9);
        // (an old save: the children had shrunken adult looks)
        for (const n of InnerMap.npcs) if (n.type === 'child') n.preset = 'male_light_1';
        InnerMapKin.update(0.1, game);
        await new Promise(r => setTimeout(r, 50));
        InnerMapKin.update(0.1, game);
        const folk = game.settlement.folk;
        const on = InnerMap.npcs.filter(n => n._person && n._folk === folk && n.state !== 'gone');
        const young = on.filter(n => n.type === 'child' && n.age < CFG.childLooks.under);
        expect(young.length).toBeGreaterThan(0);
        for (const k of young) {
            expect(String(k.preset)).toMatch(/^child:/);
            expect(k._scale).toBe(InnerMapCharacters.childScale(k.age));
            const parents = (k.parentIds || []).map(id => InnerMap.npcs.find(n => n.id === id)).filter(Boolean);
            if (parents.length) {
                const hairs = parents.map(p => InnerMapCharacters.looksOf(p.preset || InnerMapCharacters.getPresetForNPC(p.type, p.id, p.gender)))
                    .filter(Boolean).map(l => (CFG.childLooks.greyHairBecomes[l.hair] || l.hair));
                expect(hairs).toContain(InnerMapCharacters.childLookOf(k.preset).hair);
            }
        }
        for (const n of on.filter(x => x.type !== 'child' || x.age >= CFG.childLooks.under)) {
            expect(String(n.preset || '')).not.toMatch(/^child:/);
        }
        // A child spawned with no townsfolk record wears a child look too
        const stray = { id: 99901, uid: 'stray-1', type: 'child', gender: 'female', q: 2, r: 2, state: 'idle', preset: 'female_light_1' };
        InnerMap.npcs.push(stray);
        InnerMapKin.update(0.1, game);
        await new Promise(r => setTimeout(r, 50));
        InnerMapKin.update(0.1, game);
        expect(stray.age).toBeGreaterThanOrEqual(5);
        expect(stray.age).toBeLessThan(12);
        expect(String(stray.preset)).toMatch(/^child:/);
        expect(stray._scale).toBe(InnerMapCharacters.childScale(stray.age));
        // Grown past the child sprites: back to a grown look
        const k = young[0];
        k.age = CFG.childLooks.under + 1;
        InnerMapKin.update(0.1, game);
        expect(String(k.preset)).not.toMatch(/^child:/);
    });
});
