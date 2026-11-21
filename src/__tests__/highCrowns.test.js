// High crowns (systems/highCrowns.js): a second crown in personal union, the
// viceroy who rules it, the lords who want a king of their own, the offer of a
// crown by blood, a crown dictated to a beaten realm, the Empire / High
// Kingship, partition or keep-whole at succession, and the leagues' fear.

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { KingdomBonuses } from '../world/kingdomState.js';
import { CrownBooks } from '../world/crownBooks.js';
import { Economy } from '../world/economy.js';
import { Throne } from '../systems/throne.js';
import { HighCrowns } from '../systems/highCrowns.js';
import { House } from '../systems/house.js';
import { Relationships } from '../systems/relationships.js';
import { Coalitions } from '../systems/coalitions.js';
import { Victory } from '../systems/victory.js';
import { SaveLoad } from '../systems/saveLoad.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

let savedData = null;
afterEach(() => {
    if (savedData) { DataLoader._gamedata.highCrowns = savedData; savedData = null; }
});

/** Lay tuning over data/highCrowns.json for one test (a fresh object, so the config cache rebuilds). */
function tune(over) {
    savedData = DataLoader._gamedata.highCrowns;
    const copy = JSON.parse(JSON.stringify(savedData));
    const merge = (a, b) => { for (const [k, v] of Object.entries(b)) { if (v && typeof v === 'object' && !Array.isArray(v) && a[k]) merge(a[k], v); else a[k] = v; } };
    merge(copy.config, over);
    DataLoader._gamedata.highCrowns = copy;
}

function makeWorld(seed = 11) {
    Utils.setSeed(seed);
    const world = new World(40, 30);
    world.generate({ kingdomCount: 4 });
    world.day = 100;
    return world;
}

function makePlayer(world, extra = {}) {
    const player = {
        id: 'p1', name: 'Ash Ashborne', firstName: 'Ash', lastName: 'Ashborne', gender: 'male', age: 40,
        gold: 20000, karma: 0, renown: 50, reputation: {}, properties: [], colonies: [], children: [],
        skills: { commerce: 3, combat: 4, leadership: 3, diplomacy: 4, stealth: 2, cartography: 1 },
        relationships: {}, actionPoints: 10, army: [], q: 0, r: 0,
        ...extra,
    };
    Relationships.initialize(player);
    House.initialize(player, world);
    player.house.prestige = 400;
    return player;
}

/** Two living kingdoms with towns: the home crown and the far one. */
function realms(world) {
    const all = world.getAllSettlements();
    const ks = world.kingdoms.filter(k => k.isAlive && all.filter(s => s.kingdom === k.id).length >= 2);
    return [ks[0], ks[1], ks[2] || null];
}

/** A ruler of `home` who has won `far` in a civil war. */
function twoCrowns(world) {
    const player = makePlayer(world);
    const [home, far] = realms(world);
    Throne._takeThrone(player, world, home);
    Throne.state(player).civilWar = { kingdomId: far.id, levies: 0 };
    Throne._crown(player, world, far, 'won');
    return { player, home, far };
}

/** Run n days of the system (only the system: the world stands still). */
function days(world, player, n) {
    const notes = [];
    for (let i = 0; i < n; i++) {
        world.day++;
        notes.push(...HighCrowns.processDay(world, player).notices);
    }
    return notes;
}

describe('High crowns data (data/highCrowns.json)', () => {
    it('is registered and drives the config; titles follow the culture', () => {
        expect(DataLoader._gamedata.highCrowns).toBeTruthy();
        expect(HighCrowns.config().maxCrowns).toBe(DataLoader._gamedata.highCrowns.config.maxCrowns);
        expect(HighCrowns.titleFor('Imperial', 'male').title).toBe('Emperor');
        expect(HighCrowns.titleFor('Imperial', 'female').title).toBe('Empress');
        expect(HighCrowns.titleFor('Nordic', 'male').title).toBe('High King');
        expect(HighCrowns.titleFor('Nomadic', 'male').title).toBe('Khagan');
        expect(HighCrowns.titleFor('Nowhere', 'male').title).toBe('Emperor');
        expect(Object.keys(HighCrowns.decrees())).toContain('charter');
    });
});

describe('A second crown in personal union', () => {
    it('a crowned ruler may press a second claim; the crown won joins the union', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const [home, far] = realms(world);
        Throne._takeThrone(player, world, home);
        Throne.grantClaim(player, world, far.id, 'conquest', 60);
        const can = Throne.canPress(player, world, far.id, { armyStrength: 1 });
        expect(can.reason || '').not.toMatch(/already wear a crown/);

        Throne.state(player).civilWar = { kingdomId: far.id, levies: 0 };
        Throne._crown(player, world, far, 'won');
        const st = Throne.state(player);
        expect(st.ruling.kingdomId).toBe(home.id); // the home crown stays home
        expect(player.allegiance).toBe(home.id);
        const entry = HighCrowns.unionCrown(player, far.id);
        expect(entry).toBeTruthy();
        expect(entry.how).toBe('civilWar');
        expect(far.crown.union).toBe(true);
        expect(far.crown.playerRuled).toBe(false);
        expect(far.characterData.ruler.isPlayer).toBe(true);
        expect(home.allies).toContain(far.id);
        expect(far.allies).toContain(home.id);
        expect(st.claims[far.id]).toBeUndefined();
        // Readers for the other systems
        const crowns = HighCrowns.crownsOf(player, world);
        expect(crowns.map(c => c.kingdomId)).toEqual([home.id, far.id]);
        expect(crowns[0].home).toBe(true);
        expect(HighCrowns.isEmperor(player)).toBe(false);
        // No more claims on a crown already worn; no pressing it again
        expect(Throne.grantClaim(player, world, far.id, 'forged', 10)).toBe(0);
        expect(Throne.claimableKingdoms(player, world).some(k => k.id === far.id)).toBe(false);
        expect(Throne.canPress(player, world, far.id, { armyStrength: 999 }).ok).toBe(false);
    });

    it('no head carries more than maxCrowns', () => {
        const world = makeWorld();
        tune({ maxCrowns: 2 });
        const { player } = twoCrowns(world);
        const third = realms(world)[2] || world.kingdoms.find(k => k.isAlive && !HighCrowns.crownsOf(player, world).some(c => c.kingdomId === k.id));
        expect(HighCrowns.canSeekAnother(player, world, third.id).ok).toBe(false);
        expect(Throne.canPress(player, world, third.id, { armyStrength: 999 }).reason).toMatch(/2 crowns/);
    });

    it('each crown keeps its own policies, read by the kingdom bonuses and the war AI', () => {
        const world = makeWorld();
        const { player, home, far } = twoCrowns(world);
        const before = KingdomBonuses.get(far, 'tax');
        expect(HighCrowns.setPolicy(player, world, far.id, 'tax', 'heavy').success).toBe(true);
        expect(KingdomBonuses.get(far, 'tax')).toBeCloseTo(before + Throne.policies().tax.options.heavy.mods.tax, 5);
        expect(Throne.state(player).ruling.policies.tax).toBe('standard'); // the home crown's untouched
        // A union realm on a defensive stance declares no war of its own
        for (const o of world.kingdoms) if (o !== far && o !== home) { far.relations[o.id] = -100; o.military = 1; }
        far.military = 100000;
        far.wars = [];
        KingdomAI.considerWar(far, world);
        expect(far.wars).toHaveLength(0);
        HighCrowns.setPolicy(player, world, far.id, 'stance', 'aggressive');
        KingdomAI.considerWar(far, world);
        expect(far.wars.length).toBeGreaterThan(0);
    });

    it('the far crown\'s levy is real coin from its treasury; a disloyal viceroy keeps a share', () => {
        const world = makeWorld();
        const { player, far } = twoCrowns(world);
        far.treasury = 20000;
        far.stability = 80;
        const books = CrownBooks.state(far);
        books.avg = { rev: 800, exp: 0, n: 5 };
        const entry = HighCrowns.unionCrown(player, far.id);
        entry.viceroy.loyalty = 90;
        const q = HighCrowns.levyQuote(player, world, far.id);
        expect(q.levy).toBeGreaterThan(0);
        expect(q.skim).toBe(0);
        const g0 = player.gold;
        const t0 = far.treasury;
        world.day++;
        HighCrowns.processDay(world, player);
        expect(player.gold - g0).toBe(q.levy);
        expect(t0 - far.treasury).toBe(q.levy);
        // A disloyal viceroy: the levy comes in short, the difference in his till
        entry.viceroy.loyalty = 10;
        const q2 = HighCrowns.levyQuote(player, world, far.id);
        expect(q2.skim).toBeGreaterThan(0);
        const till = HighCrowns._viceroyTill(player, world, entry);
        const tillBefore = till ? Number(till.holder[till.key]) || 0 : 0;
        const g1 = player.gold;
        const t1 = far.treasury;
        world.day++;
        HighCrowns.processDay(world, player);
        const toPurse = player.gold - g1;
        const fromChest = t1 - far.treasury;
        if (till) {
            expect(toPurse).toBe(q2.levy - q2.skim);
            expect((Number(till.holder[till.key]) || 0) - tillBefore).toBe(q2.skim);
        }
        expect(fromChest).toBe(q2.levy);
    });
});

describe('The viceroy', () => {
    it('candidates include the realm\'s own great lords; appointing and favouring', () => {
        const world = makeWorld();
        const { player, far } = twoCrowns(world);
        const cands = HighCrowns.candidates(player, world, far.id);
        expect(cands.some(c => c.kind === 'native')).toBe(true);
        const native = cands.find(c => c.kind === 'native');
        const entry = HighCrowns.unionCrown(player, far.id);
        if (!(entry.viceroy.kind === native.kind && entry.viceroy.id === native.id)) {
            const p0 = player.house.prestige;
            expect(HighCrowns.appoint(player, world, far.id, native.kind, native.id).success).toBe(true);
            expect(player.house.prestige).toBe(p0 - HighCrowns.config().viceroy.replacePrestige);
        }
        expect(entry.viceroy.kind).toBe('native');
        // Honour: Prestige for favour (loyalty's target rises)
        const t0 = HighCrowns.loyaltyTarget(player, world, entry).value;
        expect(HighCrowns.favour(player, world, far.id, 'honour').success).toBe(true);
        expect(HighCrowns.loyaltyTarget(player, world, entry).value).toBeGreaterThan(t0);
        // A gift goes into his seat's coffers (a native lord): real coin
        const till = HighCrowns._viceroyTill(player, world, entry);
        const before = Number(till.holder[till.key]) || 0;
        const g = player.gold;
        expect(HighCrowns.favour(player, world, far.id, 'gift').success).toBe(true);
        expect(g - player.gold).toBe(HighCrowns.config().viceroy.giftGold);
        expect((Number(till.holder[till.key]) || 0) - before).toBe(HighCrowns.config().viceroy.giftGold);
    });

    it('competence moves the realm\'s stability through kingdom.crown.mods', () => {
        const world = makeWorld();
        const { player, far } = twoCrowns(world);
        const entry = HighCrowns.unionCrown(player, far.id);
        entry.separatism = 0;
        entry.viceroy.competence = 90;
        Throne.syncCrowns(player, world);
        const good = far.crown.mods.stability || 0;
        entry.viceroy.competence = 10;
        Throne.syncCrowns(player, world);
        expect(far.crown.mods.stability || 0).toBeLessThan(good);
        entry.viceroy = null;
        Throne.syncCrowns(player, world);
        expect(far.crown.mods.stability).toBeLessThan(0);
    });

    it('a neglected, ambitious viceroy plots, is whispered of, and crowns himself', () => {
        const world = makeWorld();
        const { player, home, far } = twoCrowns(world);
        const entry = HighCrowns.unionCrown(player, far.id);
        entry.viceroy.loyalty = 5;
        entry.viceroy.ambition = 95;
        entry.viceroy.favour = 0;
        entry.lastPresentDay = world.day - 2000;
        entry.separatism = 30;
        player.house.prestige = 0;
        far.stability = 90; // (the lords themselves are quiet: this is the viceroy's doing)
        const notes = days(world, player, 7 * 40);
        expect(notes.some(n => /Whispers/.test(n.title))).toBe(true);
        expect(notes.some(n => /Crowns Himself/.test(n.title))).toBe(true);
        expect(HighCrowns.unionCrown(player, far.id)).toBeNull();
        expect(far.crown).toBeUndefined();
        expect(far.characterData.ruler.isPlayer).toBeFalsy();
        expect((home.allies || []).includes(far.id)).toBe(false);
        expect(far.relations[home.id]).toBeLessThanOrEqual(HighCrowns.config().breakaway.relations);
        expect(HighCrowns.state(player).stats.usurped).toBe(1);
        expect(player.house.history.some(h => /crowned himself/.test(h.text))).toBe(true);
    });
});

describe('The lords who want a king of their own', () => {
    it('absence, foreign rule and heavy taxes raise separatism; a royal progress lowers it', () => {
        const world = makeWorld();
        const { player, far } = twoCrowns(world);
        const entry = HighCrowns.unionCrown(player, far.id);
        entry.viceroy.loyalty = 90;
        entry.viceroy.ambition = 0;
        entry.separatism = 40;
        entry.lastPresentDay = world.day - 500;
        HighCrowns.setPolicy(player, world, far.id, 'tax', 'heavy');
        player.q = -999; player.r = -999;
        days(world, player, 70);
        const away = entry.separatism;
        expect(away).toBeGreaterThan(40);
        // Go there: stand in the realm
        const t = far.capital;
        player.q = t.q; player.r = t.r;
        days(world, player, 70);
        expect(entry.separatism).toBeLessThan(away);
        // The charter soothes it, and costs part of the levy
        far.treasury = 20000; far.stability = 80;
        CrownBooks.state(far).avg = { rev: 800, exp: 0, n: 5 };
        const before = HighCrowns.levyQuote(player, world, far.id).levy;
        expect(HighCrowns.proclaimDecree(player, world, far.id, 'charter').success).toBe(true);
        expect(HighCrowns.levyQuote(player, world, far.id).levy).toBeLessThan(before);
        expect(HighCrowns.proclaimDecree(player, world, far.id, 'charter').success).toBe(false);
    });

    it('past breakAt in an unruly realm, the lords crown a native and the union breaks', () => {
        const world = makeWorld();
        tune({ separatism: { breakChance: 1 } });
        const { player, far } = twoCrowns(world);
        const entry = HighCrowns.unionCrown(player, far.id);
        entry.viceroy.loyalty = 90; entry.viceroy.ambition = 0;
        entry.separatism = 99;
        entry.lastPresentDay = world.day - 900;
        player.q = -999; player.r = -999;
        far.stability = 20;
        const notes = days(world, player, 8);
        expect(notes.some(n => /Breaks Away/.test(n.title))).toBe(true);
        expect(HighCrowns.unionCrown(player, far.id)).toBeNull();
        expect(HighCrowns.state(player).stats.broken).toBe(1);
        expect(far.ruler).toBeTruthy();
        expect(far.characterData.ruler.isPlayer).toBeFalsy();
    });
});

describe('Winning a crown without a civil war', () => {
    it('a faltering royal line offers its crown to a claimant of blood; accepting crowns you there', () => {
        const world = makeWorld();
        tune({ inherit: { maxChance: 1, causes: { distant_relative: 1 } } });
        const player = makePlayer(world);
        const [home, far] = realms(world);
        Throne._takeThrone(player, world, home);
        Throne.grantClaim(player, world, far.id, 'marriage', 95);
        world.day++;
        HighCrowns.processDay(world, player); // (the first look: old successions are history)
        far.lastSuccession = { day: world.day, type: 'distant_relative', crisis: false, heirName: 'Some Cousin', heirAge: 40, oldRulerName: 'Old King' };
        const notes = days(world, player, 1);
        expect(notes.some(n => /Is Offered/.test(n.title))).toBe(true);
        const offer = HighCrowns.state(player).offers[far.id];
        expect(offer).toBeTruthy();
        const cap = world.getTile(far.capital.q, far.capital.r).settlement;
        if (!cap.economy) Economy.initSettlement(cap);
        const capGold = cap.economy.gold;
        const g = player.gold;
        const res = HighCrowns.acceptOffer(player, world, far.id);
        expect(res.success).toBe(true);
        expect(g - player.gold).toBe(offer.fee);
        expect(cap.economy.gold - capGold).toBeCloseTo(offer.fee, 2);
        expect(HighCrowns.unionCrown(player, far.id).how).toBe('inherited');
        expect(HighCrowns.unionCrown(player, far.id).separatism).toBe(HighCrowns.config().separatism.start.inherited);
    });

    it('a realm beaten in war, its capital once stormed, can be made to yield its crown', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const [home, far] = realms(world);
        Throne._takeThrone(player, world, home);
        Throne.grantClaim(player, world, far.id, 'conquest', 35);
        expect(HighCrowns.canDictate(player, world, far.id).ok).toBe(false); // (not at war)
        KingdomAI.startWar(home, far, world);
        home.military = 1000;
        far.military = 2000;
        expect(HighCrowns.canDictate(player, world, far.id).reason).toMatch(/not broken/);
        far.military = 100;
        const p0 = player.house.prestige;
        const res = HighCrowns.dictate(player, world, far.id);
        expect(res.success).toBe(true);
        expect(player.house.prestige).toBeLessThan(p0);
        expect(home.wars).not.toContain(far.id);
        expect(HighCrowns.unionCrown(player, far.id).how).toBe('conquest');
        expect(HighCrowns.unionCrown(player, far.id).separatism).toBe(HighCrowns.config().separatism.start.conquest);
    });
});

describe('The high crown', () => {
    it('needs two crowns, Prestige and land; the coronation styles the ruler and fills the chronicle', () => {
        const world = makeWorld();
        tune({ proclaim: { minSettlements: 2 } });
        const player = makePlayer(world);
        const [home, far] = realms(world);
        Throne._takeThrone(player, world, home);
        expect(HighCrowns.proclaimStatus(player, world).ok).toBe(false);
        Throne.state(player).civilWar = { kingdomId: far.id, levies: 0 };
        Throne._crown(player, world, far, 'won');
        home.treasury = 5000;
        player.house.prestige = 400;
        const status = HighCrowns.proclaimStatus(player, world);
        expect(status.ok).toBe(true);
        const g = player.gold;
        const tr = home.treasury;
        const powerBefore = Coalitions.power(player, world).parts.crown;
        const res = HighCrowns.proclaim(player, world, {});
        expect(res.success).toBe(true);
        expect(HighCrowns.isEmperor(player)).toBe(true);
        expect(g - player.gold).toBe(status.fromPurse);
        expect(tr - home.treasury).toBeCloseTo(status.fromTreasury, 2);
        const e = HighCrowns.empire(player);
        expect(player.title).toContain(e.title);
        expect(player.rulerTitle).toBe(e.title);
        // The daily restyle keeps the high title
        Throne.processDaily(player, world);
        expect(player.rulerTitle).toBe(e.title);
        expect(player.house.history.some(h => (h.tags || []).includes('capstone') && /crowned/.test(h.text))).toBe(true);
        expect(world.prose && world.prose[e.proseKey]).toBeTruthy();
        // Lasting: stability in every crown; the leagues fear an emperor more
        expect(home.crown.mods.stability || 0).toBeGreaterThanOrEqual(HighCrowns.config().proclaim.stability - 1e-9);
        expect(Coalitions.power(player, world).parts.crown).toBeGreaterThan(powerBefore);
        expect(HighCrowns.coalitionFear(player)).toBeGreaterThan(1);
        // The victory goal reads it
        player.scenario = { victory: 'high_crown' };
        expect(Victory.progress(player, world, 'high_crown').done).toBe(true);
        // ...and it lapses if the crowns fall to one
        HighCrowns.release(player, world, far.id);
        const notes = days(world, player, 1);
        expect(HighCrowns.isEmperor(player)).toBe(false);
        expect(notes.some(n => /No More/.test(n.title))).toBe(true);
        expect(HighCrowns.state(player).past).toHaveLength(1);
    });

    it('a league sworn against an emperor names the false empire as its cause', () => {
        const world = makeWorld();
        const { player } = twoCrowns(world);
        HighCrowns.state(player).empire = { name: 'Empire of Test', title: 'Emperor', realmWord: 'Empire', proper: 'Test', day: 1, nextYearDay: 9999 };
        const power = Coalitions.power(player, world);
        const hostile = world.kingdoms.filter(k => k.isAlive && !HighCrowns.crownsOf(player, world).some(c => c.kingdomId === k.id))
            .map(k => ({ kingdomId: k.id, hostility: 90, vendetta: 0 }));
        if (hostile.length >= 2) {
            const out = { notices: [] };
            const c = Coalitions._form(player, world, power, hostile, out);
            expect(c.cb).toBe('empire');
            expect(c.casusBelli).toMatch(/false empire/);
        }
        // The far crown is the player's own: no regard for it in the reckoning
        const far = HighCrowns.crownsOf(player, world).find(c => !c.home).kingdom;
        expect(Coalitions.assess(player, world, far, power, [], power.realm).hostility).toBe(0);
    });
});

describe('Succession', () => {
    function withChildren(player) {
        player.children = [
            { id: 'c1', firstName: 'Bran', dynasty: 'Ashborne', gender: 'male', age: 25, isAlive: true },
            { id: 'c2', firstName: 'Cora', dynasty: 'Ashborne', gender: 'female', age: 22, isAlive: true },
        ];
    }

    it('partition gives the far crown to a grown younger child, who rules it as kin', () => {
        const world = makeWorld();
        const { player, home, far } = twoCrowns(world);
        withChildren(player);
        HighCrowns.state(player).empire = { name: 'Empire of Test', title: 'Emperor', realmWord: 'Empire', proper: 'Test', day: 1, nextYearDay: 9999 };
        expect(HighCrowns.setPlan(player, 'partition').success).toBe(true);
        expect(HighCrowns.partitionPreview(player, world)[0].child.id).toBe('c2');
        // The heir (c1) takes up the mantle; c2 is now a sibling
        const heir = player.children[0];
        player.children = player.children.filter(c => c !== heir);
        for (const c of player.children) c.isSibling = true;
        const res = HighCrowns.onSuccession(player, world, heir, {});
        expect(res.partitioned).toHaveLength(1);
        expect(res.partitioned[0].to).toMatch(/Cora/);
        expect(HighCrowns.unionCrown(player, far.id)).toBeNull();
        expect(far.characterData.ruler.firstName).toBe('Cora');
        expect(player.children[0].crownedIn.kingdomId).toBe(far.id);
        expect(home.allies).toContain(far.id);
        expect(HighCrowns.isEmperor(player)).toBe(false); // (one crown left: the high title lapses)
    });

    it('partition passes over a child in holy orders, exiled or renounced, and follows the named heir', () => {
        const world = makeWorld();
        const { player } = twoCrowns(world);
        withChildren(player);
        player.children.push({ id: 'c3', firstName: 'Dain', dynasty: 'Ashborne', gender: 'male', age: 20, isAlive: true });
        HighCrowns.setPlan(player, 'partition');
        player.children[1].crownSuccession = { orders: 5 }; // Cora took holy orders (systems/crownSuccession.js)
        expect(HighCrowns.partitionPreview(player, world)[0].child.id).toBe('c3');
        player.children[2].crownSuccession = { renounced: true };
        expect(HighCrowns.partitionPreview(player, world)[0].child).toBeNull();
        // a named heir who is not the eldest: the eldest may take the far crown
        player.children[1].crownSuccession = null;
        player.heir = 'c2';
        expect(HighCrowns.partitionPreview(player, world)[0].child.id).toBe('c1');
    });

    it('kept whole, the far crowns test the new ruler and the younger children are aggrieved', () => {
        const world = makeWorld();
        const { player, far } = twoCrowns(world);
        withChildren(player);
        HighCrowns.setPlan(player, 'whole');
        const entry = HighCrowns.unionCrown(player, far.id);
        entry.separatism = 20;
        const heir = player.children[0];
        player.children = player.children.filter(c => c !== heir);
        for (const c of player.children) c.isSibling = true;
        const res = HighCrowns.onSuccession(player, world, heir, { regency: false });
        expect(res.kept).toBe(1);
        expect(entry.separatism).toBe(20 + HighCrowns.config().succession.wholeSpike);
        expect(HighCrowns.aggrieved(player).map(a => a.id)).toEqual(['c2']);
    });

    it('when the line ends, every far crown goes back to its old line', () => {
        const world = makeWorld();
        const { player, far } = twoCrowns(world);
        Throne.passCrown(player, world, 'died');
        expect(HighCrowns.unionCrown(player, far.id)).toBeNull();
        expect(far.crown).toBeUndefined();
        expect(far.characterData.ruler.isPlayer).toBeFalsy();
    });

    it('abdicating the home crown makes the far crown the new seat', () => {
        const world = makeWorld();
        const { player, home, far } = twoCrowns(world);
        const res = Throne.abdicate(player, world);
        expect(res.success).toBe(true);
        expect(Throne.state(player).ruling.kingdomId).toBe(far.id);
        expect(player.allegiance).toBe(far.id);
        expect(HighCrowns.unionCrown(player, far.id)).toBeNull();
        expect(home.crown).toBeUndefined();
    });
});

describe('Determinism and saving', () => {
    it('the week draws from its own stream, never the shared one', () => {
        const world = makeWorld();
        const { player } = twoCrowns(world);
        while ((world.day + HighCrowns.config().offset) % HighCrowns.config().cadence !== 0) world.day++;
        world.day--;
        Utils.setSeed(77);
        const a = Utils.random();
        Utils.setSeed(77);
        days(world, player, 1);
        expect(Utils.random()).toBe(a);
    });

    it('the state rides with the player through a save', () => {
        const world = makeWorld();
        const { player, far } = twoCrowns(world);
        HighCrowns.setPlan(player, 'partition');
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('highCrowns');
        const json = JSON.parse(JSON.stringify(SaveLoad._pickDefined(player, SaveLoad.EXTRA_PLAYER_FIELDS)));
        expect(json.highCrowns.crowns[far.id].kingdomId).toBe(far.id);
        expect(json.highCrowns.plan).toBe('partition');
    });

    it('nothing runs with no player (the interregnum)', () => {
        const world = makeWorld();
        expect(HighCrowns.processDay(world, null).notices).toEqual([]);
    });
});

describe('The High Crowns panel', () => {
    it('renders the crowns, the far crown\'s viceroy, policies and decrees, and answers its buttons', async () => {
        const { ActionMenu } = await import('../ui/actionMenu/index.js');
        const world = makeWorld();
        const { player, far } = twoCrowns(world);
        HighCrowns.state(player).offers.zz = { kingdomId: realms(world)[2] ? realms(world)[2].id : far.id, name: 'X', day: 1, expires: 999, claim: 60, cause: 'distant_relative', fee: 100 };
        const shown = [];
        const game = { player, world, ui: { showCustomPanel: (title, html) => shown.push({ title, html }), showNotification: () => {}, updateStats: () => {} } };
        ActionMenu.showClaimsPanel(game, null);
        expect(shown.at(-1).html).toContain('High Crowns');
        ActionMenu.showHighCrowns(game, null);
        const main = shown.at(-1);
        expect(main.title).toContain('High Crowns');
        expect(main.html).toContain(far.name);
        expect(main.html).toContain('The crowns at your death');
        ActionMenu.showHighCrown(game, null, far.id);
        const one = shown.at(-1).html;
        expect(one).toContain('The viceroy');
        expect(one).toContain('Decrees');
        globalThis.window._highCrown.decree('charter');
        expect(HighCrowns.unionCrown(player, far.id).decrees.charter).toBeTruthy();
        globalThis.window._highCrowns.plan('partition');
        expect(HighCrowns.plan(player)).toBe('partition');
    });
});
