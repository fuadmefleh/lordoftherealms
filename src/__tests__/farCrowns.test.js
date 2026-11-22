// Far crowns' royal courts (systems/highCrowns.js running systems/kingship.js
// on a union entry through Kingship.withCourt) and the leagues' wars on far
// crowns (systems/coalitions.js): each far crown has its own vassals, council
// (the viceroy at its head), edicts beside its decrees, factions and revolts;
// its lords feed its separatism and a revolt for a native king breaks the
// union; a league marches on every far crown, and what it takes stirs them.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { Throne } from '../systems/throne.js';
import { Kingship } from '../systems/kingship.js';
import { HighCrowns } from '../systems/highCrowns.js';
import { House } from '../systems/house.js';
import { Relationships } from '../systems/relationships.js';
import { Coalitions } from '../systems/coalitions.js';
import { TradePolicy } from '../systems/tradePolicy.js';
import { SaveLoad } from '../systems/saveLoad.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function makeWorld(seed = 11) {
    Utils.setSeed(seed);
    const world = new World(40, 30);
    world.generate({ kingdomCount: 4 });
    world.day = 100;
    return world;
}

function makePlayer(world) {
    const player = {
        id: 'p1', name: 'Ash Ashborne', firstName: 'Ash', lastName: 'Ashborne', gender: 'male', age: 40,
        gold: 20000, karma: 0, renown: 50, reputation: {}, properties: [], colonies: [], children: [],
        skills: { commerce: 3, combat: 4, leadership: 3, diplomacy: 4, stealth: 2, cartography: 1 },
        relationships: {}, actionPoints: 10, army: [], q: -999, r: -999,
    };
    Relationships.initialize(player);
    House.initialize(player, world);
    player.house.prestige = 400;
    return player;
}

function realms(world) {
    const all = world.getAllSettlements();
    return world.kingdoms.filter(k => k.isAlive && all.filter(s => s.kingdom === k.id).length >= 2);
}

/** A ruler of `home` who has won `far` in a civil war; both courts sworn (one day run). */
function twoCourts(world) {
    const player = makePlayer(world);
    const [home, far] = realms(world);
    Throne._takeThrone(player, world, home);
    Throne.state(player).civilWar = { kingdomId: far.id, levies: 0 };
    Throne._crown(player, world, far, 'won');
    world.day++;
    Kingship.processDay(world, player);
    HighCrowns.processDay(world, player);
    return { player, home, far, entry: HighCrowns.unionCrown(player, far.id) };
}

function days(world, player, n) {
    const notes = [];
    for (let i = 0; i < n; i++) {
        world.day++;
        notes.push(...HighCrowns.processDay(world, player).notices);
    }
    return notes;
}

/** A faction of every lord of the far court behind `demand`, revealed. */
function factionOfAll(player, world, kid, demand) {
    return HighCrowns.inCourt(player, world, kid, (court) => {
        const f = { id: `faction_${court.idTag}_${court.nextId++}`, key: `${demand.type}:`, demand, leaderId: court.vassals[0].id, members: court.vassals.map(v => v.id), formedDay: world.day, revealed: true, ultimatum: null, refusedDay: -999 };
        for (const v of court.vassals) v.factionId = f.id;
        court.factions.push(f);
        return f;
    });
}

describe('A far crown\'s own royal court', () => {
    it('is sworn on the union entry, apart from the home court, with the viceroy at the head of its council', () => {
        const world = makeWorld();
        const { player, entry } = twoCourts(world);
        const home = Kingship.court(player);
        expect(home.initialized).toBe(true);
        expect(entry.court).toBeTruthy();
        expect(entry.court).not.toBe(home);
        expect(entry.court.initialized).toBe(true);
        expect(entry.court.vassals.length).toBeGreaterThan(0);
        expect(entry.court.idTag).toBe(`k${entry.kingdomId}`);
        // The viceroy heads the council and fills the empty seats
        expect(entry.court.council.chancellor).toMatchObject({ kind: 'viceroy' });
        expect(Kingship.OFFICES.filter(o => entry.court.council[o]).length).toBeGreaterThan(1);
        // In scope, the court functions see that realm; outside it, the home crown's
        const seen = HighCrowns.inCourt(player, world, entry.kingdomId, () => Kingship._realm(player, world).id);
        expect(seen).toBe(entry.kingdomId);
        expect(Kingship._realm(player, world).id).not.toBe(entry.kingdomId);
        expect(Kingship.court(player)).toBe(home);
        // Family and companions sit only on the home council
        const cands = HighCrowns.inCourt(player, world, entry.kingdomId, () => Kingship.candidates(player, world, 'marshal'));
        expect(cands.some(c => c.kind === 'family' || c.kind === 'companion')).toBe(false);
        expect(cands.some(c => c.kind === 'viceroy')).toBe(true);
    });

    it('its council and edicts move that realm (crown.mods, its treasury), never the home crown', () => {
        const world = makeWorld();
        const { player, home, far, entry } = twoCourts(world);
        far.treasury = 5000;
        const homeTreasury = home.treasury;
        const r = HighCrowns.inCourt(player, world, far.id, () => Kingship.passEdict(player, world, 'conscription'));
        expect(r.success).toBe(true);
        expect(entry.court.edicts.conscription).toBeTruthy();
        expect(Kingship.court(player).edicts.conscription).toBeUndefined();
        expect(far.treasury).toBeLessThan(5000);
        expect(home.treasury).toBe(homeTreasury);
        Throne.syncCrowns(player, world);
        expect(far.crown.edicts).toContain('conscription');
        expect(far.crown.mods.military).toBeGreaterThan(0);
        // The Royal Post and the crown monopolies are the home court's
        const post = HighCrowns.inCourt(player, world, far.id, () => Kingship.canPass(player, world, 'royal_post', { courierId: 'x' }));
        expect(post.ok).toBe(false);
        // Decrees and edicts share the law slots
        const slots = HighCrowns.inCourt(player, world, far.id, () => Kingship.edictSlots(player, world));
        expect(HighCrowns.proclaimDecree(player, world, far.id, 'charter').success).toBe(true);
        expect(HighCrowns.inCourt(player, world, far.id, () => Kingship.lawsInForce(player))).toBe(2);
        const ids = Object.keys(Kingship.edicts()).filter(id => !Kingship.edicts()[id].royalPost && !Kingship.edicts()[id].monopoly && id !== 'conscription' && !(Kingship.edicts()[id].excludes || []).includes('conscription'));
        for (const id of ids) {
            if (HighCrowns.inCourt(player, world, far.id, () => Kingship.lawsInForce(player)) >= slots) break;
            HighCrowns.inCourt(player, world, far.id, () => Kingship.passEdict(player, world, id));
        }
        expect(HighCrowns.inCourt(player, world, far.id, () => Kingship.lawsInForce(player))).toBe(slots);
        expect(HighCrowns.proclaimDecree(player, world, far.id, 'garrisons').success).toBe(false);
    });

    it('its lords weigh a far king: absence, the viceroy, the decrees, the talk of a king of their own', () => {
        const world = makeWorld();
        const { player, far, entry } = twoCourts(world);
        const v = entry.court.vassals[0];
        entry.lastPresentDay = world.day - 600;
        entry.separatism = 20;
        const op = () => HighCrowns.inCourt(player, world, far.id, () => Kingship.opinion(player, world, v));
        const before = op();
        expect(before.parts.some(p => p.label === 'A king far away')).toBe(true);
        expect(before.parts.some(p => /viceroy/i.test(p.label))).toBe(true);
        HighCrowns.proclaimDecree(player, world, far.id, 'tribute');
        expect(op().target).toBeLessThan(before.target);
        entry.separatism = 80;
        const angry = op();
        expect(angry.parts.some(p => p.label === 'Talk of a king of their own')).toBe(true);
        // At high discontent a sour lord bands together for a king of their own
        v.opinion = -60;
        const d = HighCrowns.inCourt(player, world, far.id, () => Kingship._demandFor(player, v));
        expect(d.type).toBe('nativeKing');
        expect(Kingship.demandText(d).label).toMatch(/king of their own/);
    });

    it('its lords\' opinion and factions feed the realm\'s separatism', () => {
        const world = makeWorld();
        const { player, far, entry } = twoCourts(world);
        for (const v of entry.court.vassals) v.opinion = 60;
        const calm = HighCrowns.courtTemper(player, world, far.id);
        for (const v of entry.court.vassals) v.opinion = -70;
        const sour = HighCrowns.courtTemper(player, world, far.id);
        expect(calm.separatism).toBeLessThan(0);
        expect(sour.separatism).toBeGreaterThan(0);
        factionOfAll(player, world, far.id, { type: 'nativeKing' });
        const plotting = HighCrowns.courtTemper(player, world, far.id);
        expect(plotting.factions).toBe(1);
        expect(plotting.separatism).toBeGreaterThan(sour.separatism);
    });
});

describe('The lords\' revolt breaks the union', () => {
    it('a revolt for a native king, won, breaks the union; its hosts go home', () => {
        const world = makeWorld();
        const { player, home, far, entry } = twoCourts(world);
        const f = factionOfAll(player, world, far.id, { type: 'nativeKing' });
        const out = { notices: [] };
        HighCrowns.inCourt(player, world, far.id, (court) => Kingship._startRevolt(player, world, court, far, f, out), out);
        expect(entry.court.revolt).toBeTruthy();
        expect(entry.court.revolt.id).toContain(entry.court.idTag);
        expect(Kingship.revolt(player)).toBeNull(); // (the home court knows nothing of it)
        Throne.syncCrowns(player, world);
        expect(far.crown.revolt).toBe(true);
        // A rebel host in the field, and a seat held against you
        HighCrowns.inCourt(player, world, far.id, (court) => Kingship._dispatchHost(world, far, court.revolt, player));
        const rec = entry.court.revolt.hosts[0];
        const unit = rec ? world.units.find(u => u.id === rec.id) : null;
        if (unit) {
            const m0 = entry.court.revolt.momentum;
            expect(Kingship.onRebelHostDefeated(player, world, unit)).toBeTruthy();
            expect(entry.court.revolt.momentum).toBeGreaterThan(m0);
        }
        const seat = entry.court.revolt.seats[0];
        if (seat) {
            const [q, r] = seat.split(',').map(Number);
            expect(Kingship.isRebelSeat(player, q, r)).toBe(true);
            expect(Kingship.rebelStrength(player, q, r)).toBe(Math.round(entry.court.revolt.strength));
        }
        expect(!!unit || !!seat).toBe(true);
        // The royal host loses: the lords have their king
        entry.court.revolt.momentum = -1000;
        const hosts = entry.court.revolt.hosts.map(h => h.id);
        const notes = days(world, player, 1);
        expect(HighCrowns.unionCrown(player, far.id)).toBeNull();
        expect(notes.some(n => /Breaks Away/.test(n.title))).toBe(true);
        expect(HighCrowns.state(player).stats.broken).toBe(1);
        expect(far.characterData.ruler.isPlayer).toBeFalsy();
        expect((home.allies || []).includes(far.id)).toBe(false);
        for (const id of hosts) expect((world.units.find(u => u.id === id) || { destroyed: true }).destroyed).toBe(true);
    });

    it('a revolt crushed quiets the realm', () => {
        const world = makeWorld();
        const { player, far, entry } = twoCourts(world);
        entry.separatism = 75;
        const f = factionOfAll(player, world, far.id, { type: 'nativeKing' });
        HighCrowns.inCourt(player, world, far.id, (court) => Kingship._startRevolt(player, world, court, far, f, { notices: [] }));
        entry.court.revolt.momentum = 1000;
        days(world, player, 1);
        expect(HighCrowns.unionCrown(player, far.id)).toBeTruthy();
        expect(entry.court.revolt).toBeNull();
        expect(entry.separatism).toBeLessThan(75 + 5 + HighCrowns.config().court.separatism.crushed);
    });

    it('conceding a king of their own ends the union in peace', () => {
        const world = makeWorld();
        const { player, far } = twoCourts(world);
        const f = factionOfAll(player, world, far.id, { type: 'nativeKing' });
        const res = HighCrowns.inCourt(player, world, far.id, () => Kingship.concede(player, world, f.id));
        expect(res.success).toBe(true);
        expect(HighCrowns.unionCrown(player, far.id)).toBeNull();
        expect(HighCrowns.state(player).stats.released).toBe(1);
        expect(far.relations[Throne.ruledKingdom(player, world).id]).toBeGreaterThan(0);
    });

    it('a native-viceroy faction conceded seats one of the realm\'s own lords', () => {
        const world = makeWorld();
        const { player, far, entry } = twoCourts(world);
        const native = HighCrowns.candidates(player, world, far.id).find(c => c.kind === 'native');
        expect(native).toBeTruthy();
        if (entry.viceroy.kind === 'native') entry.viceroy = { ...entry.viceroy, kind: 'courtier' };
        const f = factionOfAll(player, world, far.id, { type: 'nativeViceroy' });
        expect(HighCrowns.inCourt(player, world, far.id, () => Kingship.concede(player, world, f.id)).success).toBe(true);
        expect(entry.viceroy.kind).toBe('native');
    });
});

describe('The court rides with the crown', () => {
    it('the far court\'s day draws on its own stream, never the shared one', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const [home, far] = realms(world);
        Throne._takeThrone(player, world, home);
        Throne.state(player).civilWar = { kingdomId: far.id, levies: 0 };
        Throne._crown(player, world, far, 'won');
        while ((world.day + 1 + HighCrowns.config().offset) % HighCrowns.config().cadence === 0) world.day++;
        Utils.setSeed(77);
        const a = Utils.random();
        Utils.setSeed(77);
        world.day++;
        HighCrowns.processDay(world, player); // (the far court is sworn today: vassals generated)
        expect(HighCrowns.unionCrown(player, far.id).court.initialized).toBe(true);
        expect(Utils.random()).toBe(a);
    });

    it('is saved with the union and comes home when the far crown becomes the seat', () => {
        const world = makeWorld();
        const { player, far, entry } = twoCourts(world);
        const json = JSON.parse(JSON.stringify(SaveLoad._pickDefined(player, SaveLoad.EXTRA_PLAYER_FIELDS)));
        expect(json.highCrowns.crowns[far.id].court.vassals.length).toBe(entry.court.vassals.length);
        const court = entry.court;
        Throne.state(player).ruling = null;
        HighCrowns.onHomeLost(player, world);
        expect(Throne.ruledKingdom(player, world).id).toBe(far.id);
        expect(Kingship.court(player)).toBe(court);
    });
});

describe('Leagues strike the far crowns', () => {
    function league(world, player) {
        const mine = HighCrowns.crownsOf(player, world).map(c => c.kingdomId);
        const others = world.kingdoms.filter(k => k.isAlive && !mine.includes(k.id));
        const hostile = others.map(k => ({ kingdomId: k.id, hostility: 90, vendetta: 0 }));
        const power = Coalitions.power(player, world);
        const out = { notices: [] };
        const c = Coalitions._form(player, world, power, hostile, out);
        Coalitions._activate(player, world, out, 'a test');
        return { c, out, others };
    }

    it('members make war on every far crown and embargo it; its losses stir its lords, its victories cost the league', () => {
        const world = makeWorld();
        const { player, far, entry } = twoCourts(world);
        const { c } = league(world, player);
        expect(c && c.stage).toBe('active');
        const members = Coalitions.members(player);
        const warred = members.filter(m => m.farWars && m.farWars[far.id] && m.farWars[far.id].war);
        expect(warred.length).toBeGreaterThan(0);
        const m = warred[0];
        const k = world.getKingdom(m.kingdomId);
        expect(k.wars).toContain(far.id);
        expect(TradePolicy.embargoed(k, far)).toBe(true);
        // A town of the far crown falls to the member
        const town = world.getSettlementViews().find(s => s.kingdom === far.id && !(far.capital && far.capital.q === s.q && far.capital.r === s.r));
        town.kingdom = k.id; // (the live settlement on its tile)
        entry.separatism = 30;
        const r0 = c.resolve;
        const out = { notices: [] };
        const power = Coalitions.power(player, world);
        Coalitions._tickActive(player, world, power, Coalitions.assessAll(player, world, { power }), out);
        expect(world.getSettlementsOf(far.id).length).toBeLessThan(m.farWars[far.id].towns);
        expect(entry.separatism).toBeGreaterThan(30);
        expect(out.notices.some(n => /Loses Ground/.test(n.title))).toBe(true);
        expect(c.resolve).toBeGreaterThan(r0 - 4);
        // The far crown wins its war with the member: its lords cheer, the league loses heart
        const sep = entry.separatism;
        KingdomAI.endWar(k, far, world, { victor: far });
        const r1 = c.resolve;
        Coalitions._tickActive(player, world, power, Coalitions.assessAll(player, world, { power }), { notices: [] });
        expect(m.farWars[far.id].won).toBe(1);
        expect(entry.separatism).toBeLessThan(sep);
        expect(c.resolve).toBeLessThan(r1);
    });

    it('the league\'s end ends its wars on the far crowns and lifts the embargo', () => {
        const world = makeWorld();
        const { player, far } = twoCourts(world);
        league(world, player);
        const members = Coalitions.members(player).filter(m => m.farWars && m.farWars[far.id] && m.farWars[far.id].war && !m.farWars[far.id].prior);
        expect(members.length).toBeGreaterThan(0);
        Coalitions._end(player, world, 'broken', 'a test', { notices: [] });
        for (const m of members) {
            const k = world.getKingdom(m.kingdomId);
            expect(k.wars || []).not.toContain(far.id);
            expect(TradePolicy.embargoed(k, far)).toBe(false);
        }
    });
});

describe('The Royal Court panel switches crowns', () => {
    it('opens a far crown\'s court from High Crowns and answers its buttons in that court', async () => {
        const { ActionMenu } = await import('../ui/actionMenu/index.js');
        const world = makeWorld();
        const { player, far, entry } = twoCourts(world);
        far.treasury = 5000;
        const shown = [];
        const game = { player, world, ui: { showCustomPanel: (title, html) => shown.push({ title, html }), showNotification: () => {}, updateStats: () => {} } };
        ActionMenu.showHighCrown(game, null, far.id);
        expect(shown.at(-1).html).toContain('The Royal Court of');
        globalThis.window._highCrown.court();
        const panel = shown.at(-1);
        expect(panel.title).toContain(far.name.replace(/^Kingdom of /, '').split(' ')[0]);
        expect(panel.html).toContain('Your crowns:');
        expect(panel.html).toContain('Your viceroy');
        globalThis.window._court.tab('edicts');
        expect(shown.at(-1).html).toContain('Decrees of a far king');
        expect(shown.at(-1).html).not.toContain('Royal Post');
        globalThis.window._court.pass('conscription');
        expect(entry.court.edicts.conscription).toBeTruthy();
        expect(Kingship.court(player).edicts.conscription).toBeUndefined();
        globalThis.window._court.tab('realm');
        expect(shown.at(-1).html).toContain('Discontent');
        globalThis.window._court.tab('vassals');
        expect(shown.at(-1).html).toContain('Your vassals');
        // Back to the home court
        globalThis.window._court.crown(null);
        expect(shown.at(-1).title).toContain(Throne.ruledKingdom(player, world).name.split(' ').pop());
    }, 120000);
});
