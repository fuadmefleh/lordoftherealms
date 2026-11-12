// An heirless House's money (player/estateSettlement.js): the banks and the
// creditors take their share in order, the rest goes to the crown — and not
// one coin is made or lost on the way.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame, roundTrip } from './playtest/harness.js';
import { EstateSettlement } from '../player/estateSettlement.js';
import { Afterlife } from '../player/afterlife.js';
import { Finance } from '../systems/finance.js';
import { Relationships } from '../systems/relationships.js';
import { CoinCensus } from '../systems/coinCensus.js';
import { MerchantHouses } from '../systems/merchantHouses.js';
import { Inheritance } from '../systems/inheritance.js';
import { Upbringing } from '../systems/upbringing.js';

beforeAll(async () => {
    await loadData();
});

/** All the coin in the world (CoinCensus) plus the company's coffers. */
function coin(world, player) {
    const c = MerchantHouses.company(player);
    return CoinCensus.total(world, player).total + (c ? Math.max(0, c.capital || 0) : 0);
}

/** A fresh game with the player standing in a town of a realm, the banks set up. */
function setup(seed) {
    const game = newGame(seed);
    const { world, player } = game;
    const v = world.getSettlementViews().find(x => {
        const s = world.getTile(x.q, x.r).settlement;
        return s && s.kingdom != null && world.getKingdom(s.kingdom);
    });
    expect(v).toBeTruthy();
    const town = world.getTile(v.q, v.r).settlement;
    // (a purse to buy the estate's goods with: set before the coin is counted)
    if (!town.economy) town.economy = {};
    town.economy.gold = Math.max(Number(town.economy.gold) || 0, 5000);
    town.q = v.q; town.r = v.r;
    player.q = v.q; player.r = v.r;
    const k = world.getKingdom(town.kingdom);
    k.treasury = Math.max(Number(k.treasury) || 0, 5000);
    Finance.loadState(player, world);
    const fin = Finance.state(player);
    expect(fin.banks.length).toBeGreaterThanOrEqual(2);
    player.children = [];
    return { game, world, player, town, fin, crown: world.getKingdom(town.kingdom) };
}

function addLoan(fin, bank, owed) {
    fin.loans.push({ id: `L${fin.nextId++}`, bankId: bank.id, lender: bank.name, kingdomId: bank.kingdomId, principal: owed, totalOwed: owed, dailyPayment: 10, remainingDays: 30 });
}

function addCompanionWage(due) {
    let npc = Relationships._npcs.find(n => n && n.isAlive !== false);
    if (!npc) {
        npc = { id: 'npc_estate_test', firstName: 'Wat', lastName: 'Miller', isAlive: true };
        Relationships._npcs.push(npc);
    }
    npc.companion = { ...(npc.companion || {}), wageDue: due };
    return npc;
}

describe('an heirless estate', () => {
    it('a short estate: the banks are paid first, pro rata; wages go unpaid; nothing to the crown; coin conserved', () => {
        const { world, player, town, fin, crown } = setup(51);
        const [bankA, bankB] = fin.banks;
        player.gold = 1000;
        Finance.account(player, bankA.id).balance = 400; // a deposit (already in A's vault)
        addLoan(fin, bankA, 3000);
        addLoan(fin, bankB, 2000);
        const npc = addCompanionWage(150);
        player.inventory = { grain: 20 };
        player.properties = [{ type: 'house', q: town.q, r: town.r, name: 'a house' }];
        const purseBefore = npc.purse || 0;
        const aBefore = bankA.capital;
        const bBefore = bankB.capital;
        const before = coin(world, player);

        const rec = EstateSettlement.settle(player, world, { cause: 'a fever' });

        expect(coin(world, player)).toBeCloseTo(before, 1);
        expect(rec.owed).toBe(5150);
        expect(rec.unpaid).toBeGreaterThan(0);
        expect(rec.toCrown).toBe(0);
        expect(rec.toTown).toBe(0);
        expect(rec.assets.gold).toBe(1000);
        expect(rec.assets.deposits).toBe(400);
        // The crown that takes the house answers for the debt on it, up to half its worth
        expect(rec.landPaid).toBeGreaterThan(0);
        expect(rec.landPaid).toBeLessThanOrEqual(rec.land * EstateSettlement.config().landShare + 0.01);
        // The banks share pro rata (3:2), wages wait behind them
        const a = rec.claims.find(c => c.to === bankA.name);
        const b = rec.claims.find(c => c.to === bankB.name);
        expect(a.paid / 3000).toBeCloseTo(b.paid / 2000, 3);
        expect(rec.claims.find(c => c.tier === 'wages').paid).toBe(0);
        expect(npc.purse || 0).toBe(purseBefore);
        // Real coin into the real vaults (A also paid out the deposit)
        expect(bankA.capital).toBeCloseTo(aBefore - 400 + a.paid, 1);
        expect(bankB.capital).toBeCloseTo(bBefore + b.paid, 1);
        // The debts are gone; the losses are booked
        expect(fin.loans).toEqual([]);
        expect(fin.history.some(h => h.kind === 'estate_loss' && h.bankId === bankA.id)).toBe(true);
        expect(player.gold).toBe(0);
        expect(crown.treasury).toBeGreaterThanOrEqual(0);
        expect(rec.line).toMatch(/went unpaid/);
    }, 120000);

    it('a surplus estate: every creditor is paid in full and the rest goes to the crown; coin conserved', () => {
        const { world, player, fin, crown } = setup(52);
        const [bankA] = fin.banks;
        player.gold = 10000;
        player.inventory = {}; // (just the purse: the start's goods would be sold too)
        addLoan(fin, bankA, 2000);
        const npc = addCompanionWage(120);
        const purseBefore = npc.purse || 0;
        const tBefore = crown.treasury;
        const before = coin(world, player);

        const rec = EstateSettlement.settle(player, world, { cause: 'old age' });

        expect(coin(world, player)).toBeCloseTo(before, 1);
        expect(rec.unpaid).toBe(0);
        expect(rec.paid).toBe(2120);
        expect(rec.toCrown).toBe(10000 - 2120);
        expect(crown.treasury).toBeCloseTo(tBefore + rec.toCrown, 1);
        expect(crown.fisc.day.escheat).toBeCloseTo(rec.toCrown, 1);
        expect(npc.purse).toBe(purseBefore + 120);
        expect(npc.companion.wageDue).toBe(0);
        expect(rec.line).toMatch(/creditors took 2,120 crowns; the remaining 7,880 passed to the crown of/);
        // The Annals hear of it
        expect(player.house.history.some(h => h.text === rec.line)).toBe(true);

        // Exactly once
        const again = EstateSettlement.settle(player, world);
        expect(again).toBe(rec);
        expect(crown.treasury).toBeCloseTo(tBefore + rec.toCrown, 1);
    }, 120000);

    it('a House with an heir is untouched at death: the heir inherits the debts', () => {
        const { world, player, fin } = setup(53);
        const [bankA] = fin.banks;
        player.gold = 900;
        addLoan(fin, bankA, 500);
        const kid = Relationships.generateChild(player, { culture: 'Imperial' }, world);
        kid.age = 5;
        const begun = Afterlife.begin(player, world, 'a fall');
        expect(begun.estate).toBeNull();
        expect(player.estateSettled).toBeUndefined();
        expect(player.gold).toBe(900);
        expect(fin.loans.length).toBe(1);
        // ...until the last of the blood dies while the world turns
        kid.isAlive = false;
        const d = Afterlife.passDay(world, player);
        expect(d.estate).toBeTruthy();
        expect(player.estateSettled).toBe(d.estate);
        expect(fin.loans).toEqual([]);
    }, 240000);

    it('settles at a heirless death, survives a save, and the new life inherits the banks, not the debts', () => {
        const { game, world, player, fin } = setup(54);
        const [bankA] = fin.banks;
        player.gold = 3000;
        addLoan(fin, bankA, 1000);
        const begun = Afterlife.begin(player, world, 'old age');
        expect(begun.estate).toBeTruthy();
        expect(begun.estate.paid).toBe(1000);
        const back = roundTrip(game);
        expect(back.player.estateSettled).toMatchObject({ paid: 1000, toCrown: begun.estate.toCrown });

        const cand = Afterlife.candidates(world)[0];
        const capital = bankA.capital;
        const res = Afterlife.becomeStranger(player, world, cand);
        expect(res.success).toBe(true);
        expect(res.estate).toBe(begun.estate);              // not settled twice
        const nf = Finance.state(res.player);
        expect(nf.loans).toEqual([]);
        expect(Finance.bank(res.player, bankA.id).capital).toBe(capital);
        expect(res.player.origin.estate).toMatchObject({ paid: 1000 });
    }, 240000);
});

// An heir who takes up the mantle keeps part of the coin (heirSettings
// .inheritanceGoldPercent); the rest pays the debts, the other children's
// portions and the heriot to the liege crown (systems/inheritance.js) —
// every coin into a real purse.
describe('the heir\'s share and where the rest goes', () => {
    let n = 0;
    function child(player, age, extra = {}) {
        const c = {
            id: `inh_${n++}`, firstName: `Kit${n}`, dynasty: 'Harness', gender: 'female', age, isAlive: true, traits: [],
            strength: 5, charisma: 5, intelligence: 5, faith: 5, luck: 5,
            skills: { commerce: 0, combat: 0, leadership: 0, diplomacy: 0, stealth: 0, cartography: 0 }, health: 100, maxHealth: 100, ...extra,
        };
        Upbringing.ensure(c);
        if (age >= 16) c.upbringing.comeOfAge = true;
        player.children.push(c);
        return c;
    }

    it('debts first, then the siblings\' portions, then the heriot to the crown; coin conserved', () => {
        const { world, player, fin, crown } = setup(55);
        const [bankA] = fin.banks;
        player.gold = 10000;
        player.inventory = {};
        player.allegiance = crown.id;
        addLoan(fin, bankA, 500);
        const heir = child(player, 20);
        const sisA = child(player, 12);
        const sisB = child(player, 9);
        const dead = child(player, 4, { isAlive: false, purse: 30 }); // a portion that comes home
        const tBefore = crown.treasury;
        const aBefore = bankA.capital;
        const before = coin(world, player);

        const res = Relationships.succeedAsHeir(player, heir.id, world, { cause: 'old age' });

        expect(res.success).toBe(true);
        expect(coin(world, player)).toBeCloseTo(before, 1);
        const inh = res.inheritance;
        expect(inh.before).toBe(10030);                      // the dead child's portion came home first
        const keep = Relationships._getHeirSettings().inheritanceGoldPercent;
        expect(inh.kept).toBe(Math.floor(10030 * keep));
        expect(inh.debtsPaid).toBe(500);                      // the loan, paid off into the bank's vault
        expect(fin.loans).toEqual([]);
        expect(bankA.capital).toBeCloseTo(aBefore + 500, 1);
        const share = Inheritance.config().siblingShare;
        const rest = 10030 - inh.kept - 500;
        expect(inh.portionsPaid).toBeCloseTo(rest * share, 1);
        expect(sisA.purse + sisB.purse).toBeCloseTo(inh.portionsPaid, 2);
        expect(dead.purse).toBe(0);
        expect(inh.heriot).toBeCloseTo(rest - inh.portionsPaid, 1);
        expect(crown.treasury).toBeCloseTo(tBefore + inh.heriot, 1);
        expect(crown.fisc.day.heriot).toBeCloseTo(inh.heriot, 1);
        // (a disputed succession may then skim a tenth to the rival claimant, systems/house.js)
        const skim = ((res.house && res.house.fragmented) || []).filter(l => l.type === 'gold').reduce((a, l) => a + l.amount, 0);
        expect(player.gold).toBeCloseTo(inh.kept - skim, 2);
        expect(inh.line).toMatch(/the heir keeps/);
        expect(inh.line).toMatch(new RegExp(`the crown of (the )?${crown.name} as heriot`));
        expect(player.house.history.some(h => h.text === inh.line)).toBe(true);
    }, 120000);

    it('a sister who dies leaves her portion to the House; the heir brings their own; an ended House gathers the rest', () => {
        const { world, player, crown } = setup(56);
        player.gold = 4000;
        player.inventory = {};
        player.allegiance = crown.id;
        const heir = child(player, 22);
        const sis = child(player, 18);
        const bro = child(player, 17);
        const before = coin(world, player);
        Relationships.succeedAsHeir(player, heir.id, world, { cause: 'a fever' });
        expect(sis.purse).toBeGreaterThan(0);
        expect(coin(world, player)).toBeCloseTo(before, 1);

        // She dies: her portion comes home
        const purse = player.gold;
        const hers = sis.purse;
        sis.isAlive = false;
        Relationships.processDailyEvents(player, world);
        expect(sis.purse).toBe(0);
        expect(player.gold).toBeCloseTo(purse + hers, 1);
        expect(coin(world, player)).toBeCloseTo(before, 1);

        // Her brother inherits next: his portion joins the purse (and the next heriot is paid on it)
        const mid = coin(world, player);
        const his = bro.purse;
        expect(his).toBeGreaterThan(0);
        const res = Relationships.succeedAsHeir(player, bro.id, world, { cause: 'a fall' });
        expect(res.success).toBe(true);
        expect(bro.purse).toBe(0);
        expect(coin(world, player)).toBeCloseTo(mid, 1);

        // A portion still held when the House ends goes into its estate
        const late = child(player, 3, { isAlive: false, purse: 77 });
        const end = coin(world, player);
        const rec = EstateSettlement.settle(player, world, { cause: 'old age' });
        expect(rec.assets.portions).toBe(77);
        expect(late.purse).toBe(0);
        expect(coin(world, player)).toBeCloseTo(end, 1);
    }, 120000);

    it("the late ruler's goods pass to the heir: not one is lost", () => {
        const { world, player, crown } = setup(58);
        player.allegiance = crown.id;
        player.inventory = { grain: 40, iron: 7, cloth: 3 };
        const heir = child(player, 21);
        const res = Relationships.succeedAsHeir(player, heir.id, world, {});
        expect(res.success).toBe(true);
        expect(player.inventory).toMatchObject({ grain: 40, iron: 7, cloth: 3 });
        expect(player.inventory.bread || 0).toBe(0); // (no bread from nowhere)
    }, 120000);

    it('at the dawn only the purse\'s coin is shared out; the goods in kind stay with the heir', () => {
        const { world, player, crown } = setup(57);
        player.gold = 0;
        Object.defineProperty(player, '_inKind', { value: { world, coin: 1000, lastCoin: false, party: [] }, configurable: true, enumerable: false, writable: true });
        player.allegiance = crown.id;
        const heir = child(player, 20);
        const before = coin(world, player);
        const res = Relationships.succeedAsHeir(player, heir.id, world, {});
        expect(res.inheritance.before).toBe(1000);
        expect(player._inKind.coin).toBe(res.inheritance.kept);
        expect(coin(world, player)).toBeCloseTo(before, 1);
        delete player._inKind;
    }, 120000);
});
