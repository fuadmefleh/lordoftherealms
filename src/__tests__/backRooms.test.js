// Gaming and the law (systems/laws.js Laws.gambling, systems/backRooms.js):
// where the realm's vice law forbids gaming, or the town bans it by its own
// ordinance, no gaming house opens; dice go underground, behind a legitimate
// front: a gang's den, a village's quiet game, or a back room fitted in a
// tavern of the player's. Getting in costs the doorman; the watch may raid.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Laws } from '../systems/laws.js';
import { Gangs } from '../systems/gangs.js';
import { BackRooms } from '../systems/backRooms.js';
import { Underworld } from '../systems/underworld.js';
import { Tavern } from '../player/tavern.js';
import { Player } from '../player/player.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(4242));

/** A realm with a city and a village; its vice law and the towns' ordinances are the test's to set. */
function makeWorld(vice = 'tolerated') {
    const kingdom = { id: 'k1', name: 'Testmark', isAlive: true, treasury: 5000, laws: { vice } };
    const tiles = {
        '0,0': { q: 0, r: 0, settlement: { name: 'Bigtown', type: 'city', population: 6000, kingdom: 'k1', economy: { gold: 20000 }, ordinances: { vice: 'follow' } } },
        '4,0': { q: 4, r: 0, settlement: { name: 'Smallby', type: 'village', population: 200, kingdom: 'k1', economy: { gold: 300 }, ordinances: { vice: 'follow' } } },
    };
    for (const t of Object.values(tiles)) {
        t.terrain = { id: 'plains', passable: true };
        t.settlement.q = t.q;
        t.settlement.r = t.r;
    }
    return {
        day: 50, width: 40, generationParams: { seed: 77 }, kingdoms: [kingdom],
        getTile: (q, r) => tiles[`${q},${r}`] || null,
        getKingdom: id => (id === 'k1' ? kingdom : null),
        getSettlementViews: () => Object.values(tiles).map(t => t.settlement),
        getAllSettlements: () => Object.values(tiles).map(t => t.settlement),
        tiles, kingdom,
    };
}

function makePlayer() {
    const p = new Player();
    p.gold = 1000;
    p.inventory = {};
    p.q = 0; p.r = 0;
    Underworld.ensure(p);
    return p;
}

const city = (w) => w.getTile(0, 0);
const village = (w) => w.getTile(4, 0);

/** A tavern of the player's on a tile, with tables. */
function giveTavern(player, tile, tables = 2) {
    tile.playerProperty = { type: 'tavern', level: 2, gamblingTables: tables };
    tile.playerProperties = [tile.playerProperty];
    player.properties = [{ q: tile.q, r: tile.r, type: 'tavern' }];
    return tile.playerProperty;
}

describe('the law on gaming', () => {
    it('tolerated and licensed realms allow it; a forbidding realm or a town\'s own ban does not', () => {
        let w = makeWorld('tolerated');
        expect(Laws.gambling(w, city(w).settlement).legal).toBe(true);
        w = makeWorld('licensed');
        expect(Laws.gambling(w, city(w).settlement).legal).toBe(true);
        w = makeWorld('forbidden');
        const g = Laws.gambling(w, city(w).settlement);
        expect(g.legal).toBe(false);
        expect(g.forbiddenBy).toBe('realm');
        // a town may be stricter than its realm...
        w = makeWorld('licensed');
        city(w).settlement.ordinances.vice = 'forbidden';
        const t = Laws.gambling(w, city(w).settlement);
        expect(t.legal).toBe(false);
        expect(t.forbiddenBy).toBe('town');
        expect(t.why).toContain('Bigtown');
        // ...never laxer
        w = makeWorld('forbidden');
        city(w).settlement.ordinances.vice = 'follow';
        expect(Laws.gambling(w, city(w).settlement).legal).toBe(false);
    });

    it('a share of towns keep an old ban of their own (a hash of the town, the same all game)', () => {
        const w = makeWorld('tolerated');
        let banned = 0;
        for (let i = 0; i < 200; i++) {
            const s = { name: `Town${i}`, q: i, r: 3, kingdom: 'k1' };
            const a = Laws.localVice(s);
            expect(Laws.localVice({ ...s })).toBe(a);
            if (Laws.gambling(w, s).forbiddenBy === 'town') banned++;
        }
        expect(banned).toBeGreaterThan(15);
        expect(banned).toBeLessThan(70);
    });
});

describe('no gaming house where it is forbidden', () => {
    it('the tavern has no tables in the taproom; the barkeep points to a back room only if one exists', () => {
        const w = makeWorld('tolerated');
        const p = makePlayer();
        const open = Tavern.getTavernOptions(p, city(w), w).find(o => o.id === 'play_dice');
        expect(open.label).toMatch(/dice and card tables/);
        const wf = makeWorld('forbidden');
        const shut = Tavern.getTavernOptions(p, city(wf), wf).find(o => o.id === 'play_dice');
        expect(shut.label).not.toMatch(/dice and card tables/);
        expect(shut.description).toMatch(/No dice in the taproom/);
        expect(shut.available).toBe(BackRooms.games(wf, city(wf)).length > 0);
    });

    it('a tavern of yours: its tables stand idle until a back room hides them', () => {
        const w = makeWorld('forbidden');
        const p = makePlayer();
        const tav = giveTavern(p, city(w));
        expect(BackRooms.tablesRun(w, city(w), tav).open).toBe(false);
        const gold = p.gold;
        const res = BackRooms.fitBackRoom(p, w, city(w));
        expect(res.success).toBe(true);
        expect(p.gold).toBe(gold - BackRooms.config().fitCost);
        const run = BackRooms.tablesRun(w, city(w), tav);
        expect(run.open).toBe(true);
        expect(run.hidden).toBe(true);
        // where gaming is lawful there is nothing to hide
        const wl = makeWorld('tolerated');
        giveTavern(p, city(wl));
        expect(BackRooms.fitBackRoom(p, wl, city(wl)).success).toBe(false);
    });
});

describe('back rooms', () => {
    it('none where gaming is lawful; a gang\'s den behind a front where it is not', () => {
        const wl = makeWorld('tolerated');
        expect(BackRooms.games(wl, city(wl))).toEqual([]);
        const w = makeWorld('forbidden');
        const gangs = Gangs.gangsAt(w, city(w));
        expect(gangs.length).toBeGreaterThan(0);
        for (const g of gangs) g.dens = 0;
        gangs[0].dens = 1;
        const games = BackRooms.games(w, city(w));
        const den = games.find(g => g.kind === 'gang');
        expect(den).toBeTruthy();
        expect(typeof den.front).toBe('string');
        expect(BackRooms.games(w, city(w)).find(g => g.kind === 'gang').front).toBe(den.front);
    });

    it('a stranger pays the doorman more than one with a contact; the fee goes to the gang', () => {
        const w = makeWorld('forbidden');
        const p = makePlayer();
        const g = Gangs.gangsAt(w, city(w))[0];
        g.dens = 1;
        const game = BackRooms.games(w, city(w)).find(x => x.kind === 'gang');
        const stranger = BackRooms.entry(p, w, city(w), game);
        p.underworld.guild.contactMet = true;
        const known = BackRooms.entry(p, w, city(w), game);
        expect(stranger.fee).toBeGreaterThan(known.fee);
        const orig = BackRooms.raidChance;
        BackRooms.raidChance = () => 0; // (no raid tonight)
        const before = g.purse || 0;
        const r = BackRooms.enter(p, w, city(w), game.id);
        BackRooms.raidChance = orig;
        expect(r.success).toBe(true);
        expect(BackRooms.admitted(p, w, city(w))).toBe(true);
        expect(g.purse).toBeGreaterThanOrEqual(before);
    });

    it('a raid: the stakes are lost and fined to the town, and the watch remembers', () => {
        const w = makeWorld('forbidden');
        const p = makePlayer();
        Gangs.gangsAt(w, city(w))[0].dens = 1;
        const game = BackRooms.games(w, city(w)).find(x => x.kind === 'gang');
        const town = city(w).settlement;
        const gold = p.gold;
        const purseBefore = town.economy.gold;
        // force the raid
        const orig = BackRooms.raidChance;
        BackRooms.raidChance = () => 1;
        const r = BackRooms.enter(p, w, city(w), game.id);
        BackRooms.raidChance = orig;
        expect(r.raided).toBe(true);
        expect(r.lost + r.fine).toBeGreaterThan(0);
        expect(p.gold).toBeLessThan(gold);
        expect(town.economy.gold).toBeGreaterThan(purseBefore);
        expect(Underworld.getHeat(p, 'k1')).toBeGreaterThan(0);
        expect(BackRooms.admitted(p, w, city(w))).toBe(false);
    });

    it('a village with no gangs: some keep a quiet game, others none', () => {
        let some = 0;
        for (let i = 0; i < 40; i++) {
            const w = makeWorld('forbidden');
            village(w).settlement.name = `Hamlet${i}`;
            if (BackRooms.games(w, village(w)).some(g => g.kind === 'local')) some++;
        }
        expect(some).toBeGreaterThan(5);
        expect(some).toBeLessThan(40);
    });

    it('a back room of your own may be raided in the night: a fine, its tables seized', () => {
        const w = makeWorld('forbidden');
        const p = makePlayer();
        const tav = giveTavern(p, city(w), 3);
        tav.backRoom = true;
        const orig = BackRooms.config;
        BackRooms.config = () => ({ ...orig(), tavernRaid: 1e6 }); // certain tonight
        const out = BackRooms.processDay(p, w);
        BackRooms.config = orig;
        expect(out.notices.length).toBe(1);
        expect(tav.gamblingTables).toBe(0);
    });
});
