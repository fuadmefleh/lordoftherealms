// Maiming reaches further (systems/rivalCaptives.js, systems/maiming.js roadMaim, systems/maimFaith.js):
// a rival House's child taken when you beat their retinue — held, ransomed out of their purse,
// released, or maimed (their heir passed over at succession, the House a blood enemy, its friends
// angry, blood owed and paid back); a rival holding your child may maim them; bandits who beat you
// may take a hand or an ear; and the realm's faith decides how the knife is judged.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { loadData } from './playtest/harness.js';
import { Utils } from '../core/utils.js';
import { MaimMarks } from '../systems/maimMarks.js';
import { Maiming } from '../systems/maiming.js';
import { MaimFaith } from '../systems/maimFaith.js';
import { RivalCaptives } from '../systems/rivalCaptives.js';
import { RivalHouses } from '../systems/rivalHouses.js';
import { Nemesis } from '../systems/nemesis.js';
import { Devotion } from '../systems/devotion.js';
import { Laws } from '../systems/laws.js';

beforeAll(async () => { await loadData(); });
beforeEach(() => { Utils.setSeed(4242); });

function makeWorld({ faith = 'tidemother', day = 1000 } = {}) {
    const kingdom = { id: 1, name: 'Varn', isAlive: true, treasury: 5000, stability: 60, culture: 'Imperial', laws: { mutilation: 'never', punishment: 'standard' }, capital: { q: 3, r: 4 }, religion: { faithId: faith } };
    const town = { name: 'Ashford', q: 3, r: 4, kingdom: 1, folk: { q: 3, r: 4, n: 0, people: [], annals: [] }, culture: 'Imperial', economy: { gold: 2000 }, type: 'town', population: 900 };
    return {
        day, generationParams: { seed: 11 }, kingdoms: [kingdom], events: [], width: 40, height: 40, units: [],
        getTile: (q, r) => (q === 3 && r === 4 ? { q, r, settlement: town } : null),
        getSettlementViews: () => [town],
        getKingdom: (id) => (String(id) === '1' ? kingdom : null),
    };
}

function makeRival(o = {}) {
    return {
        kingdomId: 1, name: 'House Morn', feud: 40, houseKey: '1:0', gold: 2000, renown: 30, seat: { q: 3, r: 4, name: 'Ashford' },
        head: { firstName: 'Oswin', gender: 'male', age: 50, traits: [], spouse: null, children: [
            { firstName: 'Edric', gender: 'male', age: 22 },
            { firstName: 'Ada', gender: 'female', age: 17 },
        ] },
        memory: [], events: [], log: [], stats: { heads: 1 }, ties: {}, standing: {}, loans: [], ...o,
    };
}

function makePlayer(rivals, o = {}) {
    return {
        name: 'Aldric Voss', firstName: 'Aldric', gender: 'male', gold: 500, karma: 0, renown: 10, reputation: { 1: 20 }, q: 3, r: 4,
        strength: 8, charisma: 7, intelligence: 6, faith: 5, luck: 5,
        skills: { combat: 8, commerce: 5, leadership: 6, diplomacy: 7, stealth: 5, cartography: 4 },
        inventory: {}, house: { name: 'House Voss', generation: 1, prestige: 100, history: [], rivals }, children: [], ...o,
    };
}

/** Beat the retinue day after day until a child is taken (the hash roll is fixed per day). */
function takeOne(player, world, rival) {
    for (let d = world.day; d < world.day + 40; d++) {
        const w = { ...world, day: d };
        const text = RivalCaptives.onBeaten(player, w, rival);
        if (text) { world.day = d; return text; }
    }
    return null;
}

describe('RivalCaptives — a rival House\'s child in your power', () => {
    it('beating their retinue may take a grown child; held whole, they dare not strike; The Knife lists them', () => {
        const world = makeWorld();
        const rival = makeRival();
        const player = makePlayer({ 1: rival });
        const text = takeOne(player, world, rival);
        expect(text).toMatch(/taken/);
        const [cap] = RivalCaptives.list(player);
        expect(cap).toBeTruthy();
        expect(RivalCaptives.body(player, cap).captiveOf).toBe('player');
        expect(rival.feud).toBeGreaterThan(40);
        expect(RivalHouses.hostsChild(player, rival)).toBe(true);
        const t = Maiming.targets(player, world).find(x => x.kind === 'rival');
        expect(t).toBeTruthy();
        expect(t.acts.some(a => a.id === 'eye' && a.ok)).toBe(true);
        // a second beating the same day takes no one
        expect(RivalCaptives.onBeaten(player, world, rival)).toBeNull();
        // the same day, the same roll: deterministic
        const rival2 = makeRival();
        const player2 = makePlayer({ 1: rival2 });
        expect(takeOne(player2, makeWorld(), rival2)).toBe(text);
    });

    it('ransomed: their purse pays yours, the captive rides home', () => {
        const world = makeWorld();
        const rival = makeRival();
        const player = makePlayer({ 1: rival });
        takeOne(player, world, rival);
        const [cap] = RivalCaptives.list(player);
        const price = RivalCaptives.ransomPrice(player, world, cap);
        expect(price).toBeGreaterThan(0);
        const before = { p: player.gold, r: rival.gold };
        const r = RivalCaptives.ransom(player, world, cap.id);
        expect(r.success).toBe(true);
        expect(player.gold - before.p).toBeCloseTo(price, 2);
        expect(before.r - rival.gold).toBeCloseTo(price, 2);
        expect(RivalCaptives.list(player)).toHaveLength(0);
        expect(rival.head.children.every(c => !c.captiveOf)).toBe(true);
    });

    it('released for nothing: the feud cools, renown, and they remember it', () => {
        const world = makeWorld();
        const rival = makeRival();
        const player = makePlayer({ 1: rival });
        takeOne(player, world, rival);
        const feud = rival.feud;
        const r = RivalCaptives.release(player, world, RivalCaptives.list(player)[0].id);
        expect(r.success).toBe(true);
        expect(rival.feud).toBeLessThan(feud);
        expect(player.renown).toBeGreaterThan(10);
        expect(rival.memory.some(m => m.kind === 'releasedKin')).toBe(true);
    });

    it('the heir blinded: passed over at succession, the House a blood enemy, its friends angry, a nemesis, blood owed', () => {
        const world = makeWorld();
        const rival = makeRival();
        const ally = makeRival({ kingdomId: 2, name: 'House Pell', houseKey: '2:0', feud: 10, ties: { 1: 80 } });
        rival.ties = { 2: 80 };
        const player = makePlayer({ 1: rival, 2: ally });
        // take the heir (Edric, the eldest) by hand
        const edric = rival.head.children[0];
        expect(RivalHouses.heirOf(rival)).toBe(edric);
        const cap = RivalCaptives.capture(player, world, rival, edric, 'the road');
        // (held captive, he is passed over already; once home and whole he is the heir again)
        expect(RivalHouses.heirOf(rival)).toBe(rival.head.children[1]);
        expect(Maiming.act(player, world, 'rival', `c:${cap.id}`, 'eye').success).toBe(true);
        const r = Maiming.act(player, world, 'rival', `c:${cap.id}`, 'eye');
        expect(r.success).toBe(true);
        expect(MaimMarks.blind(edric)).toBe(true);
        expect(rival.feud).toBe(100);
        expect(rival.maimOwed && rival.maimOwed.act).toBe('eye');
        expect(ally.feud).toBeGreaterThanOrEqual(10 + 25);
        expect(Nemesis.state(player).grudges.some(g => g.kind === 'house')).toBe(true);
        expect(Maiming.state(player).history[0].rank).toMatch(/rival/);
        // maimed, he is no leverage
        expect(RivalHouses.hostsChild(player, rival)).toBe(false);
        // sent home, he still can never head the House
        RivalCaptives.release(player, world, cap.id);
        expect(edric.captiveOf).toBeFalsy();
        expect(RivalHouses.heirOf(rival)).toBe(rival.head.children[1]);
        // the head dies: Ada takes the House, not her blinded brother
        RivalHouses._succeed(world, rival, { notices: [] }, player);
        expect(rival.head.firstName).toBe('Ada');
    });

    it('a gelded heir cannot be matched, a captive is not matchable', () => {
        const world = makeWorld();
        const rival = makeRival();
        const player = makePlayer({ 1: rival });
        const cap = RivalCaptives.capture(player, world, rival, rival.head.children[0], 'the road');
        expect(RivalHouses.matchableChildren(rival).map(c => c.firstName)).toEqual(['Ada']);
        RivalCaptives.maim(player, world, `c:${cap.id}`, 'geld');
        RivalCaptives.release(player, world, cap.id);
        expect(RivalHouses.matchableChildren(rival).map(c => c.firstName)).toEqual(['Ada']);
    });

    it('a rival\'s ward you keep as a hostage is in your power too; maiming them breaks guest-right', () => {
        const world = makeWorld();
        const rival = makeRival();
        const player = makePlayer({ 1: rival });
        rival.head.children[1].wardOf = 'player';
        player.house.wards = [{ id: 'w1', rivalId: 1, rivalChild: 'Ada', firstName: 'Ada', kingdomId: 1, kingdomName: 'House Morn', kept: { day: 900 } }];
        const t = Maiming.targets(player, world).find(x => x.kind === 'rival' && x.ward);
        expect(t).toBeTruthy();
        expect(t.acts.some(a => a.id === 'brand')).toBe(false);
        const r = Maiming.act(player, world, 'rival', t.id, 'nose');
        expect(r.success).toBe(true);
        expect(MaimMarks.has(rival.head.children[1], 'nose')).toBe(true);
        expect(player.house.history.some(h => (h.tags || []).includes('betrayal') || /roof/.test(h.text || ''))).toBe(true);
    });
});

describe('RivalCaptives — the rival Houses do it to yours', () => {
    it('a House holding your child, its terms refused and the feud hot, may maim them (rare, once in a year)', () => {
        const world = makeWorld();
        const rival = makeRival({ feud: 95 });
        const player = makePlayer({ 1: rival });
        const child = { id: 'k1', firstName: 'Bran', gender: 'male', age: 15, isAlive: true, upbringing: { heldBy: { kingdomId: 1, rival: true, day: 900, demands: 2 } } };
        player.children = [child];
        const notices = [];
        for (let d = 1001; d <= 1001 + 7 * 200; d += 7) RivalCaptives._hostagesWeek({ ...world, day: d }, player, d, { notices }) || null;
        expect(MaimMarks.any(child)).toBe(true);
        expect(notices.length).toBeGreaterThan(0);
        expect(notices.length).toBeLessThanOrEqual(5);
        // terms never refused: no knife
        const calm = makePlayer({ 1: makeRival({ feud: 95 }) });
        calm.children = [{ id: 'k2', firstName: 'Wil', gender: 'male', age: 15, isAlive: true, upbringing: { heldBy: { kingdomId: 1, rival: true, day: 900, demands: 1 } } }];
        for (let d = 1001; d <= 1001 + 7 * 200; d += 7) RivalCaptives._hostagesWeek({ ...world, day: d }, calm, d, { notices: [] });
        expect(MaimMarks.any(calm.children[0])).toBe(false);
    });

    it('blood owed: their hired blades come sooner, and take the same', () => {
        const world = makeWorld();
        const rival = makeRival({ feud: 50, maimOwed: { act: 'eye', n: 1, day: 990, until: 990 + 1800, victim: 'Edric' } });
        const player = makePlayer({ 1: rival });
        player.children = [{ id: 'k1', firstName: 'Bran', gender: 'male', age: 20, isAlive: true }];
        const notices = [];
        for (let d = 1001; d <= 1001 + 7 * 150 && !MaimMarks.any(player.children[0]); d += 7) { world.day = d; notices.push(...Maiming.processDay(world, player).notices); }
        expect(MaimMarks.has(player.children[0], 'eye')).toBe(true);
        expect(rival.maimOwed).toBeNull();
        expect(notices.some(n => /Edric/.test(n.text))).toBe(true);
    });
});

describe('Maiming.roadMaim — bandits who beat you', () => {
    const band = (id, type = 'raider') => ({ id, name: 'Raider Band', type, strength: 20, inventory: {} });

    it('rare for a stranger, likelier for a hunter of outlaws, who loses a hand; never by beasts', () => {
        const world = makeWorld();
        let plain = 0;
        let hunter = 0;
        const acts = {};
        for (let i = 0; i < 400; i++) {
            const p = makePlayer({});
            if (Maiming.roadMaim(p, world, band(`b${i}`), 'robbed')) plain++;
            const h = makePlayer({}, { bountiesCompleted: 12 });
            const r = Maiming.roadMaim(h, world, band(`b${i}`), 'robbed');
            if (r) { hunter++; acts[r.act] = (acts[r.act] || 0) + 1; }
        }
        expect(plain).toBeLessThan(20);
        expect(hunter).toBeGreaterThan(plain);
        expect(Object.keys(acts)).toEqual(['hand']);
        expect(Maiming.roadMaim(makePlayer({}), world, { id: 'w', type: 'beast', name: 'Wolves' }, 'robbed')).toBeNull();
    });

    it('the maimed player carries a stump wound and the chronicle; the same band, day and outcome give the same answer', () => {
        const world = makeWorld();
        let got = null;
        let i = 0;
        for (; i < 2000 && !got; i++) got = Maiming.roadMaim(makePlayer({}, { bountiesCompleted: 12 }), world, band(`x${i}`), 'defeat');
        expect(got).toBeTruthy();
        const p = makePlayer({}, { bountiesCompleted: 12 });
        const again = Maiming.roadMaim(p, world, band(`x${i - 1}`), 'defeat');
        expect(again.act).toBe(got.act);
        expect(MaimMarks.has(p, again.act)).toBe(true);
        expect(p.house.history.some(h => /Raider Band/.test(h.text || ''))).toBe(true);
    });

    it('a rival House\'s waylaying men take what is owed them', () => {
        const world = makeWorld();
        let done = null;
        for (let d = 1000; d < 1040 && !done; d++) {
            const rival = makeRival({ maimOwed: { act: 'hand', n: 1, day: 990, until: 3000, victim: 'Edric' } });
            const player = makePlayer({ 1: rival });
            const unit = { id: 'ret1', type: 'rival_retinue', rivalId: 1, houseKey: '1:0', name: 'Retinue', inventory: {} };
            const r = Maiming.roadMaim(player, { ...world, day: d }, unit, 'robbed');
            if (r) done = { r, rival, player };
        }
        expect(done).toBeTruthy();
        expect(done.r.act).toBe('hand');
        expect(done.r.text).toMatch(/Edric/);
        expect(done.rival.maimOwed).toBeNull();
    });
});

describe('MaimFaith — the faith judges the knife', () => {
    it('faiths and founded creeds take a stance', () => {
        expect(MaimFaith.stanceOfFaith('earthroot')).toBe('sacred');
        expect(MaimFaith.stanceOfFaith('ironfaith')).toBe('harsh');
        expect(MaimFaith.stanceOfFaith('tidemother')).toBe('mild');
        expect(MaimFaith.stanceOfTenets(['Peace', 'Charity'])).toBe('sacred');
        expect(MaimFaith.stanceOfTenets(['Justice', 'Valor'])).toBe('harsh');
        expect(MaimFaith.creed({ religion: { name: 'The Way', tenets: ['Peace', 'Humility'] } }).stance).toBe('sacred');
        expect(MaimFaith.creed({ devotion: { faithId: 'solaris' } }).stance).toBe('harsh');
    });

    it('a sacred-body realm takes it harder than a harsh one: regard, the clergy, your own creed', () => {
        const victim = { name: 'Tom', rank: 'commoner', kingdomId: 1 };
        const sacredW = makeWorld({ faith: 'earthroot' });
        const harshW = makeWorld({ faith: 'ironfaith' });
        const a = makePlayer({}, { devotion: { faithId: 'earthroot' } });
        const b = makePlayer({});
        const ra = Maiming.brand(a, sacredW, 'hand', victim, {});
        const rb = Maiming.brand(b, harshW, 'hand', victim, {});
        expect(ra.rep).toBeLessThan(rb.rep);
        expect(ra.karma).toBeLessThan(rb.karma);
        expect(Devotion.standing(a, 'earthroot')).toBeLessThan(0);
        expect(a.faith).toBeLessThan(5);
        expect(ra.faithLine).toMatch(/sin against the body/);
        // lawful: the harsh realm barely minds
        const c = makePlayer({});
        const rc = Maiming.brand(c, harshW, 'hand', victim, { lawful: true });
        expect(rc.rep).toBeGreaterThanOrEqual(-1);
    });

    it('a mutilation law costs a sacred-body realm more to proclaim, a harsh one less', () => {
        const cost = (faith) => {
            const world = makeWorld({ faith });
            const player = makePlayer({}, { throne: { ruling: { kingdomId: 1, since: 0 } } });
            return Laws.canEnact(player, world, 'mutilation', 'old');
        };
        const s = cost('earthroot');
        const m = cost('tidemother');
        const h = cost('ironfaith');
        expect(s.ok && m.ok && h.ok).toBe(true);
        expect(s.stability).toBeGreaterThan(m.stability);
        expect(s.cost).toBeGreaterThan(m.cost);
        expect(h.stability).toBeLessThanOrEqual(m.stability);
        expect(h.cost).toBeLessThan(m.cost);
    });
});

describe('RivalCaptives — seized under guest-right', () => {
    function scene(o = {}) {
        const world = makeWorld();
        world.kingdoms.push({ id: 2, name: 'Pell', isAlive: true, treasury: 100, stability: 50, religion: { faithId: 'earthroot' } });
        const rival = makeRival(o.rival || {});
        const other = makeRival({ kingdomId: 2, name: 'House Pell', houseKey: '2:0', feud: 10, ties: {} });
        const player = makePlayer({ 1: rival, 2: other }, { reputation: { 1: 20, 2: 20 }, ...(o.player || {}) });
        world.units = [{ id: 'ret1', type: 'rival_retinue', rivalId: 1, houseKey: '1:0', q: 3, r: 4, strength: 20, name: 'Retinue', inventory: {} }];
        return { world, rival, other, player };
    }

    it('their retinue at your side: a chance to seize a child, better at your own table', () => {
        const a = scene();
        const plain = RivalCaptives.seizeChance(a.player, a.world, a.rival);
        expect(plain).toBeTruthy();
        expect(plain.feast).toBe(false);
        const b = scene({ player: { feasts: { history: [{ d: 1000, town: 'Ashford' }] } } });
        const feast = RivalCaptives.seizeChance(b.player, b.world, b.rival);
        expect(feast.feast).toBe(true);
        expect(feast.chance).toBeGreaterThan(plain.chance);
        // retinue elsewhere: no one within reach
        a.world.units[0].q = 30;
        expect(RivalCaptives.seizeChance(a.player, a.world, a.rival)).toBeNull();
    });

    it('taken or not, guest-right is broken: every House, every realm, the faith; far worse than the road', () => {
        let took = null;
        let failed = null;
        for (let d = 1000; d < 1060 && !(took && failed); d++) {
            const s = scene();
            s.world.day = d;
            const r = RivalCaptives.seize(s.player, s.world, 1);
            expect(r.success).toBe(true);
            if (r.ok && !took) took = { ...s, r };
            if (!r.ok && !failed) failed = { ...s, r };
            // one try a day
            expect(RivalCaptives.seize(s.player, s.world, 1).success).toBe(false);
        }
        expect(took && failed).toBeTruthy();
        const cap = RivalCaptives.list(took.player)[0];
        expect(cap.guestRight).toBe(true);
        expect(took.rival.feud).toBe(100);
        expect(took.other.feud).toBeGreaterThanOrEqual(30);
        expect(took.player.reputation[2]).toBeLessThan(20);
        expect(took.player.reputation[1]).toBeLessThanOrEqual(0);
        expect(took.player.atrocities.perfidy).toBeGreaterThan(0);
        expect(took.player.karma).toBeLessThanOrEqual(-15);
        expect(Devotion.standing(took.player, 'tidemother')).toBeLessThan(0);
        // a road capture costs none of it
        const road = scene();
        RivalCaptives.capture(road.player, road.world, road.rival, road.rival.head.children[0], 'the road');
        expect(road.other.feud).toBe(10);
        expect(road.player.karma).toBe(0);
        // a failed try: half the shame, and the feud flares
        expect(RivalCaptives.list(failed.player)).toHaveLength(0);
        expect(failed.rival.feud).toBeGreaterThanOrEqual(80);
        expect(failed.player.karma).toBeLessThan(0);
        expect(failed.player.karma).toBeGreaterThan(took.player.karma);
    });
});

describe('RivalCaptives — the years in your keeping', () => {
    it('they come of age while held, and may die there (sickness, despair, a rescue gone wrong)', () => {
        const world = makeWorld();
        const rival = makeRival();
        const player = makePlayer({ 1: rival });
        const ada = rival.head.children[1];
        ada.age = 15;
        const cap = RivalCaptives.capture(player, world, rival, ada, 'the road');
        ada.age = 16;
        const out = { notices: [] };
        RivalCaptives.week({ ...world, day: 1007 }, player, 1007, out);
        expect(out.notices.some(n => /Comes of Age/.test(n.title))).toBe(true);
        expect(cap.grown).toBe(true);
        // years in the cells, maimed: sooner or later they die (or are rescued)
        MaimMarks.mark(ada, 'hand');
        const notes = [];
        for (let d = 1035; d < 1035 + 28 * 400 && RivalCaptives.list(player).length; d += 28) RivalCaptives.week({ ...world, day: d }, player, d, { notices: notes });
        expect(RivalCaptives.list(player)).toHaveLength(0);
        const died = notes.find(n => n.title === 'A Captive Dies');
        if (died) {
            expect(rival.head.children.includes(ada)).toBe(false);
            expect(rival.memory.some(m => m.kind === 'diedCaptive')).toBe(true);
        } else {
            expect(notes.some(n => n.title === 'A Captive Rescued')).toBe(true);
        }
    });

    it('the head dies while you hold a child: the captive stays tied to the living House', () => {
        const world = makeWorld();
        const rival = makeRival();
        const player = makePlayer({ 1: rival });
        const edric = rival.head.children[0];
        const cap = RivalCaptives.capture(player, world, rival, edric, 'the road');
        RivalHouses._succeed(world, rival, { notices: [] }, player);
        expect(rival.head.firstName).toBe('Ada');
        expect(rival.head.children).toContain(edric);
        expect(RivalCaptives.body(player, cap)).toBe(edric);
        expect(edric.sibling).toBe(true);
        // a save and a load: still the same record, no stale copy
        player.house = JSON.parse(JSON.stringify(player.house));
        player.maiming = JSON.parse(JSON.stringify(player.maiming));
        const again = RivalCaptives.list(player)[0];
        expect(again.person).toBeUndefined();
        expect(RivalCaptives.body(player, again)).toBe(player.house.rivals[1].head.children.find(c => c.firstName === 'Edric'));
    });

    it('the only one fit to rule is yours: the captive heads the House from your keeping — dearer to ransom, set aside if maimed', () => {
        const world = makeWorld();
        const rival = makeRival();
        rival.head.children = [{ firstName: 'Edric', gender: 'male', age: 22 }];
        const player = makePlayer({ 1: rival });
        const edric = rival.head.children[0];
        const cap = RivalCaptives.capture(player, world, rival, edric, 'the road');
        const asHeir = RivalCaptives.ransomPrice(player, world, cap);
        RivalHouses._succeed(world, rival, { notices: [] }, player);
        expect(rival.head).toBe(edric);
        expect(rival.headCaptive).toBe(true);
        expect(RivalCaptives.isHead(player, cap)).toBe(true);
        expect(RivalCaptives.ransomPrice(player, world, cap)).toBeGreaterThan(asHeir);
        const t = Maiming.targets(player, world).find(x => x.kind === 'rival');
        expect(t.rank).toBe('rivalHead');
        expect(t.desc).toMatch(/Head of House Morn/);
        // still whole: leverage
        expect(RivalHouses.hostsChild(player, rival)).toBe(true);
        // maimed past ruling: set aside, a cousin heads the House; he stays yours, and theirs
        RivalCaptives.maim(player, world, `c:${cap.id}`, 'nose');
        expect(rival.head).not.toBe(edric);
        expect(rival.headCaptive).toBe(false);
        expect(RivalCaptives.body(player, cap)).toBe(edric);
        expect(rival.feud).toBe(100);
    });
});

describe('Maiming — aids before the town has given out its trades', () => {
    it('no craftsman on the roster yet: the market stalls make it, the fee to the town', async () => {
        const { SettlementMarket } = await import('../world/settlementMarket.js');
        const world = makeWorld();
        const town = world.getTile(3, 4).settlement;
        SettlementMarket.add(town, 'leather', 3);
        const player = makePlayer({});
        MaimMarks.mark(player, 'eye');
        const patch = Maiming.aidOptions(player, world, town).find(o => o.id === 'eye_patch');
        expect(patch.ok).toBe(true);
        expect(patch.maker).toMatch(/stalls of Ashford/);
        const before = { gold: player.gold, town: town.economy.gold };
        expect(Maiming.buyAid(player, world, town, 'eye_patch').success).toBe(true);
        expect(before.gold - player.gold).toBeCloseTo(patch.cost, 2);
        expect(town.economy.gold - before.town).toBeCloseTo(patch.cost, 2);
    });
});
