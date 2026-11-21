// Write your name on the world (systems/namedLegacy.js): a law code that binds
// heirs and steadies the realm, towns/regions/seas named after the House with
// their folk's pride or resentment, a founding myth heirs invoke once a reign,
// and an old ruler's last chapter in the epitaph, the Annals and the heir.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { NamedLegacy } from '../systems/namedLegacy.js';
import { Laws } from '../systems/laws.js';
import { House } from '../systems/house.js';
import { Legacy } from '../systems/legacy.js';
import { Traits } from '../systems/traits.js';
import { Annals } from '../systems/annals.js';
import { MetaLegacy } from '../systems/metaLegacy.js';
import { Coalitions } from '../systems/coalitions.js';
import { Relationships } from '../systems/relationships.js';
import { SaveLoad } from '../systems/saveLoad.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const W = 14, H = 10;

/** A small world: water on the west columns (q < 3), land elsewhere; three towns of realm k0, one of k1. */
function makeWorld() {
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) {
            const water = q < 3;
            row.push({ q, r, explored: true, terrain: { id: water ? 'ocean' : 'plains', passable: !water }, regionId: water ? 1 : 2 });
        }
        tiles.push(row);
    }
    const towns = [
        { name: 'Harrowgate', type: 'capital', kingdom: 'k0', culture: 'Imperial', q: 3, r: 4, population: 900, economy: { gold: 500 } },
        { name: 'Millbrook', type: 'town', kingdom: 'k0', culture: 'Imperial', q: 7, r: 2, population: 400, economy: { gold: 200 } },
        { name: 'Ostrava', type: 'town', kingdom: 'k0', culture: 'Northern', q: 9, r: 7, population: 350, economy: { gold: 200 } },
        { name: 'Far Keep', type: 'capital', kingdom: 'k1', culture: 'Northern', q: 12, r: 5, population: 600, economy: { gold: 300 } },
    ];
    for (const s of towns) tiles[s.r][s.q].settlement = s;
    const kingdoms = [
        { id: 'k0', name: 'Valdor', ruler: 'Queen Mara', treasury: 20000, stability: 50, isAlive: true, capital: { q: 3, r: 4 }, culture: 'Imperial', characterData: { ruler: { name: 'Mara' } } },
        { id: 'k1', name: 'Eskarth', ruler: 'King Brannoc', treasury: 5000, stability: 65, isAlive: true, capital: { q: 12, r: 5 }, culture: 'Northern', characterData: { ruler: { name: 'Brannoc', firstName: 'Brannoc' } } },
    ];
    return {
        day: 1000, width: W, height: H, tiles, kingdoms, generationParams: { seed: 77 },
        getKingdom: id => kingdoms.find(k => k.id === id) || null,
        getTile: (q, r) => (r >= 0 && r < H && q >= 0 && q < W ? tiles[r][q] : null),
        getSettlementViews: () => towns,
    };
}

function makePlayer(world) {
    const p = {
        id: 'p1', name: 'Aldric Vane', firstName: 'Aldric', lastName: 'Vane', gender: 'male', age: 45, maxLifespan: 70,
        culture: 'Imperial', gold: 30000, q: 3, r: 4, renown: 10, children: [], ships: [],
        throne: { ruling: { kingdomId: 'k0', since: 200 } },
    };
    House.initialize(p, world);
    p.house.prestige = 1000;
    Legacy.ensure(p, world);
    p.house.currentReign.startDay = 200;
    return p;
}

let world, player;
beforeEach(() => {
    world = makeWorld();
    player = makePlayer(world);
    Relationships._npcs = [];
});

describe('the Code', () => {
    it('jurists cost Prestige and treasury gold (paid to the capital) and take their days; then the laws are fixed', () => {
        const k = world.kingdoms[0];
        const cap = world.tiles[4][3].settlement;
        const can = NamedLegacy.canCompile(player, world);
        expect(can.ok).toBe(true);
        expect(can.name).toMatch(/Aldric/);
        const r = NamedLegacy.compile(player, world);
        expect(r.success).toBe(true);
        expect(player.house.prestige).toBe(1000 - can.prestige);
        expect(k.treasury).toBe(20000 - can.gold);
        expect(cap.economy.gold).toBe(500 + can.gold);
        expect(NamedLegacy.inForce(world, k)).toBe(null);
        // Not yet
        world.day += can.days - 1;
        NamedLegacy.processDay(world, player);
        expect(NamedLegacy.inForce(world, k)).toBe(null);
        world.day += 1;
        const st0 = k.stability;
        const out = NamedLegacy.processDay(world, player);
        const c = NamedLegacy.inForce(world, k);
        expect(c).toBeTruthy();
        expect(out.notices.some(n => /Proclaimed/.test(n.title))).toBe(true);
        expect(k.stability).toBeGreaterThan(st0);
        expect(Object.keys(c.laws).length).toBe(Laws.list().length);
        // A second code is refused while this one is young
        expect(NamedLegacy.canCompile(player, world).ok).toBe(false);
    });

    it('a codified law costs Prestige, more gold and stability to change, and is struck from the code', () => {
        const k = world.kingdoms[0];
        const target = Laws.value(world, 'k0', 'punishment') === 'harsh' ? 'lenient' : 'harsh';
        const free = Laws.canEnact(player, world, 'punishment', target);
        NamedLegacy.compile(player, world);
        world.day += 400;
        NamedLegacy.processDay(world, player);
        const bound = Laws.canEnact(player, world, 'punishment', target);
        expect(bound.ok).toBe(true);
        expect(bound.cost).toBeGreaterThan(free.cost);
        expect(bound.stability).toBeGreaterThan(free.stability);
        expect(bound.bound.prestige).toBeGreaterThan(0);
        const pr = player.house.prestige;
        const res = Laws.enact(player, world, 'punishment', target);
        expect(res.success).toBe(true);
        expect(res.text).toMatch(/Struck from/);
        expect(player.house.prestige).toBe(pr - bound.bound.prestige);
        expect(NamedLegacy.inForce(world, k).struck.punishment).toBe(world.day);
        // Struck: free to change again (after the cooldown) without the code's price
        world.day += 60;
        expect(Laws.canEnact(player, world, 'punishment', 'standard').bound).toBeFalsy();
        // Too little Prestige to strike another
        player.house.prestige = 0;
        const other = Laws.list().find(l => l.id !== 'punishment' && l.options.length > 1);
        const opt = other.options.find(o => o.id !== Laws.value(world, 'k0', other.id));
        const no = Laws.canEnact(player, world, other.id, opt.id);
        expect(no.ok).toBe(false);
        expect(no.reason).toMatch(/fixed in/);
    });

    it('a code steadies month by month, thins the courts, shuts suits, names itself and earns the realms\' respect', () => {
        const k = world.kingdoms[0];
        expect(NamedLegacy.disputeFactor(world, 'k0')).toBe(1);
        expect(NamedLegacy.respectFactor(world, k)).toBe(1);
        expect(NamedLegacy.courtLine(world, 'k0')).toBe('');
        NamedLegacy.compile(player, world);
        world.day = 1000 + 240;
        NamedLegacy.processDay(world, player);
        k.stability = 40;
        world.day = 1260; // a month boundary
        NamedLegacy.processDay(world, player);
        expect(k.stability).toBe(41);
        expect(NamedLegacy.disputeFactor(world, 'k0')).toBeLessThan(1);
        expect(NamedLegacy.respectFactor(world, k)).toBeLessThan(1);
        expect(NamedLegacy.courtLine(world, 'k0')).toMatch(/judged under the .*Aldric/);
        // Some suits are shut, not all (a hash of the suit)
        let shut = 0;
        for (let i = 0; i < 200; i++) if (NamedLegacy.codeSettles(world, 'k0', `r|${i}`)) shut++;
        expect(shut).toBeGreaterThan(30);
        expect(shut).toBeLessThan(120);
        // Coalitions read the respect: a crown under a code is less hated
        const other = world.kingdoms[1];
        const power = { score: 80 };
        const points = [{ q: 3, r: 4 }];
        const withCode = Coalitions.assess(player, world, other, power, points, k);
        delete k.laws.code;
        const without = Coalitions.assess(player, world, other, power, points, k);
        expect(withCode.hostility).toBeLessThanOrEqual(without.hostility);
        if (without.hostility > 5) expect(withCode.hostility).toBeLessThan(without.hostility);
    });

    it('an AI crown of a steady realm may write its own code (a hash roll, the same every run)', () => {
        const k1 = world.kingdoms[1];
        k1.stability = 90;
        const C = NamedLegacy.config().code;
        let compiledOn = null;
        for (let d = 700; d < 700 + 120 * 400 && compiledOn == null; d++) {
            world.day = d;
            NamedLegacy.processDay(world, null);
            if (NamedLegacy.code(world, k1)) compiledOn = d;
        }
        expect(compiledOn).not.toBe(null);
        expect(NamedLegacy.code(world, k1).name).toMatch(/Brannoc/);
        // ...and proclaims it once the jurists are done, with player null (the interregnum tick)
        world.day = compiledOn + C.days;
        NamedLegacy.processDay(world, null);
        expect(NamedLegacy.inForce(world, k1)).toBeTruthy();
        // Deterministic: a fresh world rolls the same day
        const w2 = makeWorld();
        w2.kingdoms[1].stability = 90;
        let again = null;
        for (let d = 700; d <= compiledOn && again == null; d++) { w2.day = d; NamedLegacy.processDay(w2, null); if (NamedLegacy.code(w2, w2.kingdoms[1])) again = d; }
        expect(again).toBe(compiledOn);
    });
});

describe('names on the map', () => {
    it('renaming a town of the House\'s culture: the name changes, its people follow, the town is proud', () => {
        const s = world.tiles[2][7].settlement; // Millbrook, Imperial
        Relationships._npcs = [{ id: 'n1', settlementName: 'Millbrook', isAlive: true }];
        const opts = NamedLegacy.nameOptions(player, world, 'town', s);
        expect(opts.length).toBeGreaterThan(0);
        expect(opts.every(n => !/^Port /.test(n))).toBe(true); // an inland town gets no port name
        const gold = player.gold;
        const r = NamedLegacy.name(player, world, 'town', 7, 2, opts[0]);
        expect(r.success).toBe(true);
        expect(s.name).toBe(opts[0]);
        expect(s.foundingName).toBe('Millbrook');
        expect(s.namedBy.mood).toBe('proud');
        expect(Relationships._npcs[0].settlementName).toBe(opts[0]);
        expect(player.gold).toBe(gold - NamedLegacy.config().names.town.gold);
        expect(s.economy.gold).toBe(200 + NamedLegacy.config().names.town.gold);
        expect(s.memory.marks.some(m => m.k === 'name' && m.house === player.house.name)).toBe(true);
        expect(NamedLegacy.annalsLines(player, world).join(' ')).toMatch(new RegExp(opts[0]));
    });

    it('a town of another culture resents it, the realm wobbles, and it takes its old name back once out of the House\'s hands', () => {
        const s = world.tiles[7][9].settlement; // Ostrava, Northern
        const k = world.kingdoms[0];
        const st0 = k.stability;
        const nm = NamedLegacy.nameOptions(player, world, 'town', s)[0];
        expect(NamedLegacy.name(player, world, 'town', 9, 7, nm).success).toBe(true);
        expect(s.namedBy.mood).toBe('resent');
        expect(k.stability).toBeLessThan(st0);
        expect(s.memory.marks.some(m => m.k === 'grudge' && m.why === 'renamed')).toBe(true);
        // Held: it keeps the name
        const Y = 120;
        world.day = 1020;
        NamedLegacy.processDay(world, player);
        expect(s.name).toBe(nm);
        // The House loses the crown: after revertYears out of its hands, the old name comes back
        player.throne.ruling = null;
        world.day = 1050;
        NamedLegacy.processDay(world, player);
        world.day = 1050 + NamedLegacy.config().names.revertYears * Y + 30;
        const out = NamedLegacy.processDay(world, player);
        expect(s.name).toBe('Ostrava');
        expect(s.namedBy).toBeUndefined();
        expect(out.notices.some(n => /Name Taken Back/.test(n.title))).toBe(true);
    });

    it('a region and a sea are named, found by placeAt, labelled on the map, and saved with the world', () => {
        const opts = NamedLegacy.nameOptions(player, world, 'sea', world.tiles[4][3].settlement);
        expect(opts.length).toBeGreaterThan(0);
        expect(NamedLegacy.name(player, world, 'sea', 3, 4, opts[0]).success).toBe(true);
        const reg = NamedLegacy.nameOptions(player, world, 'region', world.tiles[2][7].settlement)[0];
        expect(NamedLegacy.name(player, world, 'region', 7, 2, reg).success).toBe(true);
        expect(NamedLegacy.placeAt(world, 1, 4).name).toBe(opts[0]); // water off the capital
        expect(NamedLegacy.placeAt(world, 8, 3).name).toBe(reg); // land by Millbrook
        expect(NamedLegacy.placeAt(world, 13, 9)).toBe(null);
        expect(NamedLegacy.mapLabels(world).map(l => l.name)).toEqual([opts[0], reg]);
        // The same sea can't be named twice
        expect(NamedLegacy.canName(player, world, 'sea', 3, 4, 'Another Sea').ok).toBe(false);
        // Saved and restored
        const saved = NamedLegacy.serialize(world);
        const w2 = makeWorld();
        NamedLegacy.restore(JSON.parse(JSON.stringify(saved)), w2);
        expect(NamedLegacy.placeAt(w2, 1, 4).name).toBe(opts[0]);
        expect(typeof SaveLoad.serializeWorld).toBe('function');
    });

    it('only what the House holds can be named', () => {
        expect(NamedLegacy.canName(player, world, 'town', 12, 5, 'Aldricton').ok).toBe(false);
        player.throne.ruling = null;
        expect(NamedLegacy.canName(player, world, 'town', 7, 2, 'Aldricton').ok).toBe(false);
    });
});

describe('the founding myth', () => {
    it('tales come from the real record; one is adopted, invoked once a reign, and repeated in town talk', () => {
        // A record of three field victories at the Ford of Ash
        for (let i = 0; i < 3; i++) House.recordBattle(player, world, { foe: 'the Reavers', place: 'the Ford of Ash', outcome: 'victory' });
        const cands = NamedLegacy.mythCandidates(player, world);
        const sword = cands.find(c => c.id === 'sword');
        expect(sword).toBeTruthy();
        expect(sword.tale).toMatch(/Ford of Ash/);
        expect(cands.find(c => c.id === 'crown')).toBeTruthy(); // the crown of Valdor
        expect(cands.find(c => c.id === 'road')).toBeTruthy();
        expect(cands.find(c => c.id === 'gold')).toBeTruthy(); // 30,000 in the purse
        const r = NamedLegacy.adoptMyth(player, world, 'sword');
        expect(r.success).toBe(true);
        expect(NamedLegacy.myth(player.house).name).toBe(sword.name);
        // Repeated in town talk where the House rules
        const facts = NamedLegacy.overheardFacts(player, world, world.tiles[2][7].settlement, 'Aldric', { their: 'his', them: 'him' });
        expect(facts.some(f => f.src === 'myth' && /Ford of Ash/.test(f.gist))).toBe(true);
        expect(NamedLegacy.overheardFacts(player, world, world.tiles[5][12].settlement, 'Aldric', {}).length).toBe(0);
        // Rally: stability up, once a reign
        const k = world.kingdoms[0];
        const st0 = k.stability;
        expect(NamedLegacy.invoke(player, world, 'rally').success).toBe(true);
        expect(k.stability).toBe(st0 + NamedLegacy.config().myth.rally.stability);
        expect(NamedLegacy.invoke(player, world, 'legitimacy').success).toBe(false);
        // The next reign may call on it again
        player.house.generation = 2;
        expect(NamedLegacy.canInvoke(player, world, 'legitimacy').ok).toBe(true);
    });

    it('a crown inherited is worn, not taken; codes are never named with an -ine form', () => {
        player.throne.ruling.inherited = true;
        const cands = NamedLegacy.mythCandidates(player, world);
        expect(cands.find(c => c.id === 'crown')).toBeFalsy();
        const held = cands.find(c => c.id === 'crownHeld');
        expect(held).toBeTruthy();
        expect(held.tale).not.toMatch(/took the crown/);
        expect(held.tale).not.toMatch(/crown of Kingdom/); // (the realm takes its article)
        for (const n of ['Aldric', 'Wanderer', 'Bram', 'Osric']) {
            for (let i = 0; i < 8; i++) expect(NamedLegacy.codeNameFor(n, `k${i}`)).not.toMatch(/ine Code/);
        }
    });

    it('legitimacy steadies the next succession (House._disputeChance reads it) until it lapses', () => {
        NamedLegacy.adoptMyth(player, world, 'road');
        const before = House._disputeChance(player.house, { day: world.day });
        expect(NamedLegacy.invoke(player, world, 'legitimacy').success).toBe(true);
        expect(NamedLegacy.legitimacy(player, world).active).toBe(true);
        const after = House._disputeChance(player.house, { day: world.day });
        expect(after).toBeLessThan(before);
        const late = world.day + NamedLegacy.config().myth.legitimacyHoldDays + 1;
        expect(House._disputeChance(player.house, { day: late })).toBe(before);
    });

    it('a claim invocation strengthens a claim the House holds', async () => {
        const { Throne } = await import('../systems/throne.js');
        Throne.grantClaim(player, world, 'k1', 'forged', 10, { mode: 'add' });
        NamedLegacy.adoptMyth(player, world, 'road');
        const before = Throne.claimStrength(player, 'k1');
        expect(NamedLegacy.claimTargets(player, world).map(k => k.id)).toContain('k1');
        expect(NamedLegacy.invoke(player, world, 'claim', 'k1').success).toBe(true);
        expect(Throne.claimStrength(player, 'k1')).toBeGreaterThan(before);
    });
});

describe('the final chapter', () => {
    it('only an old ruler writes it; it sets the motto, the epitaph, the Annals and the Hall, and the heir takes the trait', () => {
        expect(NamedLegacy.canWriteFinal(player, world).ok).toBe(false);
        player.age = 67; // within nearDeathYears of a 70-year span, and over 60
        expect(NamedLegacy.canWriteFinal(player, world).ok).toBe(true);
        // Law: earned by a code of this ruler's
        NamedLegacy.compile(player, world);
        world.day += 300;
        NamedLegacy.processDay(world, player);
        const law = NamedLegacy.finalChoices(player, world).find(c => c.id === 'law');
        expect(law.fits).toBe(true);
        const r = NamedLegacy.writeFinalChapter(player, world, 'law', 'Written and Kept');
        expect(r.success).toBe(true);
        expect(player.house.motto).toBe('Written and Kept');
        expect(NamedLegacy.canWriteFinal(player, world).ok).toBe(false); // once a ruler
        // The epitaph line
        expect(Legacy.epitaph(player, world).line).toMatch(/law written in the House's name/);
        // The Annals' legacy
        const book = Annals.compose(player, world);
        expect(book.legacy.text).toMatch(/remembered for the law/i);
        expect(book.legacy.text).toMatch(/Aldric/);
        // The Hall of Houses
        const hall = MetaLegacy.entryFor(player, world, Legacy.epitaph(player, world));
        expect(hall.rememberedFor).toMatch(/law/);
        expect(hall.codes.length).toBe(1);
        // The chronicle book's epilogue
        expect(NamedLegacy.bookView(player, world).epilogue).toMatch(/last chapter/);
        // The heir is raised to it
        player.traits = Traits._blank();
        const res = NamedLegacy.onSuccession(player, world, { oldName: 'Aldric Vane' });
        expect(Traits.has(player, 'honest')).toBe(true);
        expect(res.notices.length).toBe(1);
        expect(player.house.namedLegacy.heirBoon).toBe(null);
    });

    it('an unearned remembrance passes the words, not the trait', () => {
        player.age = 64;
        const conquest = NamedLegacy.finalChoices(player, world).find(c => c.id === 'conquest');
        expect(conquest.fits).toBe(false);
        expect(NamedLegacy.writeFinalChapter(player, world, 'conquest', 'Steel Before Silk').success).toBe(true);
        expect(player.house.namedLegacy.heirBoon).toBe(null);
    });

    it('the House\'s legacy state rides on the House through save and load', () => {
        NamedLegacy.adoptMyth(player, world, 'road');
        player.age = 66;
        NamedLegacy.writeFinalChapter(player, world, 'peace', 'Mercy Holds');
        const data = House.serialize(player.house);
        const p2 = { id: 'p1', lastName: 'Vane' };
        House.deserialize(p2, world, JSON.parse(JSON.stringify(data)));
        expect(NamedLegacy.myth(p2.house).id).toBe('road');
        expect(NamedLegacy.lastChapter(p2.house).motto).toBe('Mercy Holds');
    });
});
