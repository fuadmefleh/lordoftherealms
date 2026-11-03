// Violence on the street map: who saw it, what gets recorded, what the
// witnesses remember, and what they (and those who only heard) say after.
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { StreetCrime } from '../systems/streetCrime.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { Underworld } from '../systems/underworld.js';
import { Townsfolk } from '../systems/townsfolk.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const TOWN = { q: 5, r: 5 };

function makeWorld(day = 10) {
    const towns = {
        '5,5': { q: 5, r: 5, settlement: { name: 'Ashford', kingdom: 'k1', type: 'town' } },
        '9,9': { q: 9, r: 9, settlement: { name: 'Brightwater', kingdom: 'k1', type: 'village' } },
    };
    return {
        day, width: 20, height: 20,
        generationParams: { seed: 7 },
        kingdoms: [{ id: 'k1', name: 'Kelmar' }],
        getTile: (q, r) => towns[`${q},${r}`] || null,
        getSettlementViews: () => [],
    };
}

function makePlayer() {
    return { name: 'Aric', gold: 500, karma: 0, renown: 10, reputation: { k1: 0 }, skills: { stealth: 1 }, q: TOWN.q, r: TOWN.r };
}

let _id = 0;
function npc(name, type, q, r, extra = {}) {
    return { id: _id++, name, type, q, r, state: 'idle', personalityTraits: [], ...extra };
}

/** The scene, the street: a victim and the people around them. */
function street() {
    const victim = npc('Brom', 'farmer', 10, 10, { gender: 'male' });
    const wife = npc('Ada', 'villager', 30, 30, { spouseId: victim.id, gender: 'female' });   // far off, but kin
    victim.spouseId = wife.id;
    const near = npc('Mira', 'merchant', 12, 9);                  // 2 tiles: sees it
    const bold = npc('Tor', 'villager', 9, 11, { personalityTraits: ['bold'] });
    const far = npc('Holt', 'villager', 25, 25);                  // too far to see
    const indoors = npc('Siv', 'villager', 11, 10, { state: 'inside_building' }); // indoors, sees nothing
    const guardFar = npc('Dag', 'guard', 20, 10);                 // 10 tiles: hears, comes running
    const guardNear = npc('Knut', 'guard', 13, 10);
    return { victim, wife, near, bold, far, indoors, guardFar, guardNear, all: [victim, wife, near, bold, far, indoors, guardFar, guardNear] };
}

function recordOn(s, crime, player, world) {
    const scene = { q: s.victim.q, r: s.victim.r, indoors: false };
    const witnesses = StreetCrime.selectWitnesses(s.all, scene, s.victim);
    for (const w of witnesses) w.mood = StreetCrime.reactionFor(w, crime, { seed: 't', victimName: s.victim.name }).mood;
    const res = StreetCrime.record(player, world, { crime, victim: s.victim, witnesses, q: TOWN.q, r: TOWN.r, scene, onMap: s.all });
    return { res, witnesses };
}

describe('StreetCrime: who saw it', () => {
    it('picks those in sight on the street, not the far, the hidden or the victim', () => {
        const s = street();
        const ws = StreetCrime.selectWitnesses(s.all, { q: 10, r: 10, indoors: false }, s.victim);
        const seen = ws.filter(w => w.seen).map(w => w.npc.name).sort();
        expect(seen).toEqual(['Knut', 'Mira', 'Tor']);
        expect(ws.some(w => w.npc === s.victim)).toBe(false);
        expect(ws.some(w => w.npc === s.indoors)).toBe(false);
        expect(ws.some(w => w.npc === s.far)).toBe(false);
    });

    it('guards out of sight but in earshot come running (unseen)', () => {
        const s = street();
        const ws = StreetCrime.selectWitnesses(s.all, { q: 10, r: 10 }, s.victim);
        const dag = ws.find(w => w.npc === s.guardFar);
        expect(dag).toBeTruthy();
        expect(dag.seen).toBe(false);
        expect(dag.role).toBe('guard');
        expect(StreetCrime.reactionFor(dag, 'assault', { seed: 'x', victimName: 'Brom' }).act).toBe('arrest');
    });

    it('indoors, everyone in the building sees it, however far', () => {
        const victim = npc('Lars', 'merchant', 2, 2);
        const inn = [victim, npc('Una', 'villager', 9, 9, { state: 'inside_building' }), npc('Finn', 'villager', 3, 3, { state: 'inside_building' })];
        const ws = StreetCrime.selectWitnesses(inn, { q: 2, r: 2, indoors: true }, victim);
        expect(ws.map(w => w.npc.name).sort()).toEqual(['Finn', 'Una']);
        expect(ws.every(w => w.seen)).toBe(true);
    });

    it('names the victim\'s kin as kin, with the right word', () => {
        const s = street();
        s.wife.q = 11; s.wife.r = 11;
        const ws = StreetCrime.selectWitnesses(s.all, { q: 10, r: 10 }, s.victim);
        const ada = ws.find(w => w.npc === s.wife);
        expect(ada.role).toBe('kin');
        expect(ada.kinWord).toBe('husband');
    });

    it('bystanders bark and react; children always run', () => {
        const kid = npc('Pip', 'child', 11, 10);
        const r = StreetCrime.reactionFor({ npc: kid, role: 'bystander', seen: true }, 'murder', { seed: 's', victimName: 'Brom' });
        expect(r.act).toBe('flee');
        expect(r.mood).toBe('fear');
        expect(typeof r.bark).toBe('string');
        const bold = StreetCrime.reactionFor({ npc: npc('Tor', 'villager', 0, 0, { personalityTraits: ['bold'] }), role: 'bystander', seen: true }, 'assault', { seed: 's', victimName: 'Brom' });
        expect(bold.mood).toBe('anger');
        expect(bold.act).toBe('stand');
    });
});

describe('StreetCrime: the crime is recorded', () => {
    it('an assault: a rumour with the real witnesses, heat, an incident, the annals', () => {
        const player = makePlayer();
        const world = makeWorld();
        const s = street();
        const { res } = recordOn(s, 'assault', player, world);
        expect(res.witnessed).toBe(true);
        expect(res.rumour.type).toBe('assault');
        // Mira, Tor, Knut, and the beaten man himself
        expect(res.witnessCount).toBe(4);
        expect(Underworld.getHeat(player, 'k1')).toBeGreaterThan(0);
        expect(player.reputation.k1).toBeLessThan(0);
        expect(res.incident).toMatchObject({ k: 'assault', victim: 'Brom', key: '5,5', kingdom: 'k1', answered: false });
        expect(player.streetCrime.incidents).toHaveLength(1);
    });

    it('a murder is a distinct crime, graver than an assault', () => {
        const pa = makePlayer();
        const pm = makePlayer();
        const a = recordOn(street(), 'assault', pa, makeWorld()).res;
        const m = recordOn(street(), 'murder', pm, makeWorld()).res;
        expect(m.rumour.type).toBe('murder');
        expect(m.rumour.severity).toBeGreaterThan(a.rumour.severity);
        expect(Underworld.getHeat(pm, 'k1')).toBeGreaterThan(Underworld.getHeat(pa, 'k1'));
        expect(pm.karma).toBeLessThan(pa.karma);
        expect(pm.gossip.totalKills).toBe(1);
    });

    it('a killing no one saw: no rumour, but karma and some heat all the same', () => {
        const player = makePlayer();
        const victim = npc('Ulf', 'villager', 3, 3);
        const res = StreetCrime.record(player, makeWorld(), { crime: 'murder', victim, witnesses: [], q: TOWN.q, r: TOWN.r, scene: { q: 3, r: 3 }, onMap: [victim] });
        expect(res.witnessed).toBe(false);
        expect(res.rumour).toBe(null);
        expect(player.karma).toBe(StreetCrime.config().karmaUnseen.murder);
        expect(Underworld.getHeat(player, 'k1')).toBeGreaterThan(0);
        expect(Underworld.getHeat(player, 'k1')).toBeLessThan(Underworld.crimeDef('murder').heat);
        expect(StreetCrime.unansweredAt(player, '5,5', 10)).toHaveLength(0);
    });
});

describe('StreetCrime: witnesses remember', () => {
    it('writes what each witness saw into their memory and sours them', () => {
        const player = makePlayer();
        const s = street();
        recordOn(s, 'murder', player, makeWorld());
        const mem = NpcDisposition.getMemory(s.near);
        expect(mem.saw).toHaveLength(1);
        expect(mem.saw[0]).toMatchObject({ k: 'murder', v: 'Brom', rel: 'bystander', seen: true });
        expect(mem.disposition).toBeLessThan(50);
        // The wife was across town, but kin learn of it, and hold a grudge
        const ada = NpcDisposition.getMemory(s.wife);
        expect(ada.saw[0]).toMatchObject({ rel: 'kin', kin: 'husband', seen: false });
        expect(ada.grudge).toBeTruthy();
        // The far bystander saw nothing
        expect(s.far._dialogMemory).toBeUndefined();
    });

    it('a beating that becomes a killing is remembered as the killing', () => {
        const player = makePlayer();
        const s = street();
        recordOn(s, 'assault', player, makeWorld());
        recordOn(s, 'murder', player, makeWorld());
        const mem = NpcDisposition.getMemory(s.near);
        expect(StreetCrime.memoryOf(s.near).k).toBe('murder');
        expect(mem.saw.filter(e => e.rel === 'bystander')).toHaveLength(1);
        expect(player.streetCrime.incidents.map(i => i.k)).toEqual(['assault', 'murder']);
    });

    it('the beaten victim remembers it themselves', () => {
        const player = makePlayer();
        const s = street();
        recordOn(s, 'assault', player, makeWorld());
        expect(StreetCrime.memoryOf(s.victim)).toMatchObject({ rel: 'victim', k: 'assault' });
    });

    it('family on the town roster who were not on the street learn of it, and the annals keep a beating', () => {
        const player = makePlayer();
        const world = makeWorld();
        const brom = { id: 0, first: 'Brom', last: 'Hayward', gender: 'male', born: -4000, died: null, role: 'farmer', spouse: 1, parents: [], kids: [2], away: null, log: [] };
        const ada = { id: 1, first: 'Ada', last: 'Hayward', gender: 'female', born: -4000, died: null, role: 'villager', spouse: 0, parents: [], kids: [2], away: null, log: [] };
        const kid = { id: 2, first: 'Wren', last: 'Hayward', gender: 'female', born: -1500, died: null, role: 'villager', spouse: null, parents: [0, 1], kids: [], away: null, log: [] };
        const folk = { q: 5, r: 5, n: 3, people: [brom, ada, kid], annals: [] };
        const victim = npc('Brom', 'farmer', 4, 4, { gender: 'male' });
        Object.defineProperty(victim, '_person', { value: brom });
        Object.defineProperty(victim, '_folk', { value: folk });
        StreetCrime.record(player, world, { crime: 'assault', victim, witnesses: [], q: 5, r: 5, scene: { q: 4, r: 4 }, onMap: [victim] });
        expect(ada.mem.saw[0]).toMatchObject({ rel: 'kin', kin: 'husband', k: 'assault' });
        expect(kid.mem.saw[0]).toMatchObject({ rel: 'kin', kin: 'father' });
        expect(ada.mem.disposition).toBeLessThan(50);
        expect(folk.annals.some(e => e.k === 'beaten' && e.a === 0)).toBe(true);
        expect(Townsfolk.annalText(folk, folk.annals[0], world)).toMatch(/Brom Hayward was beaten in the street/);
    });
});

describe('StreetCrime: what they say', () => {
    it('a witness names the deed and the victim; a stranger in a town untouched says nothing', () => {
        const player = makePlayer();
        const world = makeWorld();
        const s = street();
        recordOn(s, 'murder', player, world);
        const said = StreetCrime.dialogFor(s.near, player, world, { key: '5,5', day: 10 });
        expect(said.kind).toBe('witness');
        expect(said.text).toContain('Brom');
        expect(['fear', 'anger']).toContain(said.mood);
        // Someone in a town the rumour has not reached knows nothing of it
        const stranger = npc('Odo', 'villager', 1, 1);
        expect(StreetCrime.dialogFor(stranger, player, world, { key: '9,9', day: 10 })).toBe(null);
    });

    it('a kinsman speaks of "my husband"', () => {
        const player = makePlayer();
        const world = makeWorld();
        const s = street();
        recordOn(s, 'murder', player, world);
        const said = StreetCrime.dialogFor(s.wife, player, world, { key: '5,5', day: 10 });
        expect(said.role).toBe('kin');
        expect(said.text).toContain('my husband Brom');
    });

    it('those who did not see it hear of it over the following days, and say so more vaguely', () => {
        const player = makePlayer();
        const world = makeWorld(10);
        const s = street();
        recordOn(s, 'murder', player, world);
        // Within a few days everyone in town has heard
        const townsfolk = Array.from({ length: 12 }, (_, i) => npc(`T${i}`, 'villager', 0, 0, { uid: `5,5#t${i}` }));
        const heardDay0 = townsfolk.filter(t => StreetCrime.hearsay(player, world, t, '5,5', 10)).length;
        const heardDay5 = townsfolk.filter(t => StreetCrime.hearsay(player, world, t, '5,5', 15)).length;
        expect(heardDay5).toBeGreaterThanOrEqual(heardDay0);
        expect(heardDay5).toBe(12);
        const said = StreetCrime.dialogFor(townsfolk[0], player, world, { key: '5,5', day: 15 });
        expect(said.kind).toBe('hearsay');
        expect(said.text).toContain('Brom');
        expect(said.text).not.toBe(StreetCrime.dialogFor(s.near, player, world, { key: '5,5', day: 15 }).text);
        // Hearing it sours them, once
        const d1 = townsfolk[0]._dialogMemory.disposition;
        expect(d1).toBeLessThan(50);
        for (let i = 0; i < 5; i++) {
            townsfolk[0]._dialogMemory.timesSpoken++;
            StreetCrime.dialogFor(townsfolk[0], player, world, { key: '5,5', day: 15 });
        }
        expect(townsfolk[0]._dialogMemory.disposition).toBe(d1);
    });

    it('a trader who saw a killing will not deal, nor talk', () => {
        const player = makePlayer();
        const s = street();
        recordOn(s, 'murder', player, makeWorld());
        const pm = NpcDisposition.getPriceModifiers(s.near);
        expect(pm.refuses).toBe(true);
        expect(pm.refuseReason).toContain('Brom');
        expect(StreetCrime.refusesTalk(s.near)).toBe(true);
        // A stranger trades as usual
        expect(NpcDisposition.getPriceModifiers(npc('Lena', 'merchant', 0, 0)).refuses).toBe(false);
    });
});

describe('StreetCrime: the watch', () => {
    it('a guard who saw it moves to arrest; a beating can be paid off', () => {
        const player = makePlayer();
        const world = makeWorld();
        const s = street();
        const { res } = recordOn(s, 'assault', player, world);
        const said = StreetCrime.dialogFor(s.guardNear, player, world, { key: '5,5', day: 10 });
        expect(said.role).toBe('guard');
        expect(said.arrest).toBe(true);
        const view = StreetCrime.watchView(player, world, res.incident.id, 'Knut');
        expect(view.options.map(o => o.id)).toEqual(['submit', 'fine', 'run', 'resist']);
        const gold = player.gold;
        const out = StreetCrime.answerWatch(player, world, res.incident.id, 'fine');
        expect(out.outcome).toBe('fined');
        expect(player.gold).toBe(gold - out.fine);
        expect(StreetCrime.pendingAt(player, '5,5', 10)).toBe(null);
        expect(player.gossip.bounties.filter(b => b.kingdom === 'k1')).toHaveLength(0);
    });

    it('no paying off a murder: giving yourself up means the cells', () => {
        const player = makePlayer();
        const world = makeWorld();
        const { res } = recordOn(street(), 'murder', player, world);
        const view = StreetCrime.watchView(player, world, res.incident.id, 'Knut');
        expect(view.options.some(o => o.id === 'fine')).toBe(false);
        expect(StreetCrime.answerWatch(player, world, res.incident.id, 'fine').invalid).toBe(true);
        const out = StreetCrime.answerWatch(player, world, res.incident.id, 'submit', { name: 'Ashford', kingdom: 'k1' });
        expect(out.outcome).toBe('jailed');
        expect(player.jailState.offense).toBe('murder');
        expect(player.jailState.daysRemaining).toBeGreaterThanOrEqual(StreetCrime.config().arrest.days.murder);
        expect(StreetCrime.pendingAt(player, '5,5', 10)).toBe(null);
    });

    it('a guard who saw a settled beating speaks of the killing still unanswered', () => {
        const player = makePlayer();
        const world = makeWorld();
        const s = street();
        const a = recordOn(s, 'assault', player, world).res;
        StreetCrime.answerWatch(player, world, a.incident.id, 'fine');
        // The guard has wandered off; the killing happens out of his sight
        s.guardNear.q = 60; s.guardNear.r = 60; s.guardFar.q = 60;
        recordOn(s, 'murder', player, world);
        const said = StreetCrime.dialogFor(s.guardNear, player, world, { key: '5,5', day: 10 });
        expect(said.arrest).toBe(true);
        expect(said.crime).toBe('murder');
        expect(said.text).toContain('Brom');
    });

    it('the watch forgets an unanswered crime after its window', () => {
        const player = makePlayer();
        recordOn(street(), 'assault', player, makeWorld(10));
        expect(StreetCrime.pendingAt(player, '5,5', 12)).toBeTruthy();
        expect(StreetCrime.pendingAt(player, '5,5', 10 + StreetCrime.config().arrest.windowDays + 1)).toBe(null);
    });
});

describe('Coming upon a body', () => {
    const victim = { id: 1, name: 'Mara', gender: 'female' };
    const body = { name: 'Mara', _npc: victim };
    it('kin mourn at the side of the dead, and name them', () => {
        const r = StreetCrime.foundReaction({ id: 2, name: 'Tom', type: 'villager', spouseId: 1 }, body, { seed: 's' });
        expect(r.act).toBe('mourn');
        expect(r.role).toBe('kin');
        expect(r.kinWord).toBe('wife');
        expect(r.implicates).toBe(false);
        expect(r.bark).toBeTruthy();
        expect(r.bark).not.toMatch(/\{/);
    });
    it('the watch looks into it; a child runs', () => {
        expect(StreetCrime.foundReaction({ id: 3, type: 'guard' }, body, { seed: 's' }).act).toBe('investigate');
        expect(['flee', 'cower']).toContain(StreetCrime.foundReaction({ id: 4, type: 'child' }, body, { seed: 's' }).act);
    });
    it('a bystander gathers, stares or runs, and always says something', () => {
        for (let i = 0; i < 10; i++) {
            const r = StreetCrime.foundReaction({ id: 10 + i, type: 'villager', personalityTraits: [] }, body, { seed: `b${i}` });
            expect(['gather', 'stare']).toContain(r.act);
            expect(r.bark).toBeTruthy();
        }
    });
    it('caught carrying or standing over the body, the player is seen for a killer', () => {
        const g = StreetCrime.foundReaction({ id: 3, type: 'guard' }, body, { carried: true, seed: 's' });
        expect(g.act).toBe('arrest');
        expect(g.implicates).toBe(true);
        const b = StreetCrime.foundReaction({ id: 5, type: 'villager' }, body, { playerOver: true, seed: 's' });
        expect(b.implicates).toBe(true);
        expect(['flee', 'stand']).toContain(b.act);
    });
});

describe('Visible reactions', () => {
    it('every mood has a short emote', () => {
        for (const m of ['fear', 'anger', 'grief']) expect(StreetCrime.foundEmote(m, 'x')).toBeTruthy();
    });
});
