// The Church panel (ui/actionMenu/church.js): it draws the see, a call to the
// player's crown, the cross, the bans and the inquisitor in town without holes,
// and its buttons answer, take the cross, deal with the inquisitor and seek
// absolution through the systems (systems/holyWars.js, systems/inquisition.js).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { HolyWars } from '../systems/holyWars.js';
import { Inquisition } from '../systems/inquisition.js';
import { Devotion } from '../systems/devotion.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { SettlementMarket } from '../world/settlementMarket.js';

let ActionMenu;

beforeAll(async () => {
    if (!DataLoader._gamedata) { DataLoader.clearCache(); await DataLoader.initializeAll(); }
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
}, 120000);

function realm(id, name, faithId, q, r) {
    return { id, name, isAlive: true, treasury: 4000, military: 400, population: 20000, capital: { q, r }, territory: [{ q, r }], wars: [], allies: [], relations: {}, laws: { heresy: 'holy_office' }, religion: { faithId, piety: 60, unity: 60, heresies: [], holySites: [] } };
}

function makeGame() {
    const ks = [realm('k1', 'Valdor', 'solaris', 2, 2), realm('k2', 'Aster', 'solaris', 8, 2), realm('k3', 'Kharn', 'ironfaith', 8, 8)];
    ks[1].crown = { playerRuled: true };
    const towns = [
        { name: 'Solhaven', type: 'city', q: 2, r: 2, kingdom: 'k1', population: 4000, economy: { gold: 4000 } },
        { name: 'Asterby', type: 'city', q: 8, r: 2, kingdom: 'k2', population: 3000, economy: { gold: 3000 } },
        { name: 'Kharnhold', type: 'city', q: 8, r: 8, kingdom: 'k3', population: 3000, economy: { gold: 3000 } },
    ];
    const tiles = new Map(towns.map(s => [`${s.q},${s.r}`, { q: s.q, r: s.r, kingdom: s.kingdom, settlement: s }]));
    const world = {
        day: 402, baseYear: 853, width: 40, height: 30, generationParams: { seed: 61 }, events: [], kingdoms: ks, units: [],
        getKingdom: id => ks.find(k => k.id === id) || null, getTile: (q, r) => tiles.get(`${q},${r}`) || null, getSettlementViews: () => towns,
    };
    for (const s of towns) { Townsfolk.seed(s, world, { q: s.q, r: s.r }); SettlementMarket.ensure(s); }
    const player = { name: 'Aldo Harness', gold: 3000, q: 8, r: 2, karma: 0, reputation: {}, skills: {}, throne: { ruling: { kingdomId: 'k2' } }, house: { name: 'House Harness', generation: 1, prestige: 50, rivals: {}, history: [] } };
    Devotion.state(player).faithId = 'solaris';
    HolyWars.processDay(world, player);
    const panels = [];
    const notes = [];
    const game = { world, player, ui: { showCustomPanel: (t, h) => panels.push({ t, h }), showNotification: (t, m) => notes.push(m), updateStats() {} } };
    return { game, world, player, ks, panels, notes };
}

const clean = (h) => !/undefined|NaN|\[object/.test(h.replace(/data-am-args="[^"]*"/g, ''));

describe('the Church panel', () => {
    it('draws the see, a call to your crown, the cross and an inquisitor, and acts through the systems', () => {
        const { game, world, player, ks, panels } = makeGame();
        const see = HolyWars.see(world, 'solaris|orthodox');
        const war = HolyWars.call(world, player, see, ks[2], 'infidel', null);
        const inq = Inquisition.commission(world, see, ks[1]);
        inq.q = 8; inq.r = 2; inq.town = 'Asterby'; inq.phase = 'hearing'; inq.hearingEnd = world.day + 5;
        ActionMenu.showChurch(game);
        let h = panels[panels.length - 1].h;
        expect(panels[panels.length - 1].t).toContain('The Church');
        expect(h).toContain('The Church calls your crown');
        expect(h).toContain('Take the cross');
        expect(h).toContain(inq.name);
        expect(h).toContain('Host him');
        expect(clean(h)).toBe(true);
        // answer the call through the panel's router
        ActionMenu.churchAct(game, 'answer_call', war.id, 1);
        expect(ks[1].wars).toContain('k3');
        // host the inquisitor
        ActionMenu.churchAct(game, 'inq', inq.id, 'host');
        expect(player.inquisition.favour[inq.id]).toBeGreaterThan(world.day);
        h = panels[panels.length - 1].h;
        expect(clean(h)).toBe(true);
    });

    it('shows a ban on you and the ways back', () => {
        const { game, world, player, panels } = makeGame();
        const see = HolyWars.see(world, 'solaris|orthodox');
        HolyWars._ban(world, player, see, 'k2', 'defying the Church', { notices: [] });
        ActionMenu.showChurch(game);
        const h = panels[panels.length - 1].h;
        expect(h).toContain('lies under the ban');
        // (a realm named 'Kingdom of …' opens the card's title with a capital)
        game.world.getKingdom('k2').name = 'Kingdom of Aster';
        ActionMenu.showChurch(game);
        expect(panels[panels.length - 1].h).toContain('The Kingdom of Aster lies under the ban');
        expect(h).toContain('Send a gift to the see');
        expect(clean(h)).toBe(true);
        ActionMenu.churchAct(game, 'absolve', see.key, 'k2', 'pay');
        expect(see.bans.k2).toBeUndefined();
    });

    it('a holy war against your realm: the terms the see may hear, offered from the panel', () => {
        const { game, world, player, ks, panels } = makeGame();
        const see = HolyWars.see(world, 'solaris|orthodox');
        HolyWars._ban(world, player, see, 'k2', 'defying the Church', { notices: [] });
        const war = HolyWars.call(world, player, see, ks[1], 'excommunicate', null);
        expect(war.members).toContain('k1');
        // (into the field, past the weeks the see hears no terms)
        for (let i = 0; i < 90; i++) { world.day++; HolyWars.processDay(world, player); }
        expect(war.phase).toBe('war');
        ActionMenu.showChurch(game);
        let h = panels[panels.length - 1].h;
        expect(h).toContain('Terms to offer the see');
        expect(h).toContain('Pay a penance to the see');
        expect(h).toContain('Submit to the see');
        expect(clean(h)).toBe(true);
        // (the see takes it)
        const T = JSON.parse(JSON.stringify(DataLoader._gamedata.holyWars.terms));
        DataLoader._gamedata.holyWars.terms.accept = { ...T.accept, min: 1, max: 1 };
        try { ActionMenu.churchAct(game, 'terms', war.id, 'submit'); } finally { DataLoader._gamedata.holyWars.terms = T; }
        expect(HolyWars.state(world).wars).not.toContain(war);
        expect(see.bans.k2).toBeUndefined();
        expect(ks[1].wars).not.toContain('k1');
        h = panels[panels.length - 1].h;
        expect(h).not.toContain('Terms to offer the see');
        expect(clean(h)).toBe(true);
    });

    it('shows a Knight of the Cross his honour', async () => {
        const { game, world, player, panels } = makeGame();
        HolyWars._knightPlayer(world, player, { id: 9, name: 'the Holy War against Kharn', faithId: 'solaris', target: 'k3' }, { notices: [] });
        HolyWars._knightPlayer(world, player, { id: 10, name: 'the Holy War against Kharn', faithId: 'solaris', target: 'k3' }, { notices: [] });
        expect(HolyWars.styleOf(player)).toBe('Knight of the Cross (twice)');
        ActionMenu.showChurch(game);
        const h = panels[panels.length - 1].h;
        expect(h).toContain('Knight of the Cross (twice)');
        expect(clean(h)).toBe(true);
        expect(player.house.honours.length).toBe(1);
    });
});
