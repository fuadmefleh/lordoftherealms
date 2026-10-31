// Relationships — folk members: the townsfolk (systems/townsfolk.js) step into
// the player's life. A grown townsperson the player knows can be befriended,
// courted, wed or taken on the road like any relationship NPC: the bridge makes
// one relationship NPC per person (npc.folkUid ↔ person.rnpc) and keeps the
// two in step — age, marriage, death, and whether they are at home or away
// with the player (person.away.withPlayer, which keeps them off the town's
// streets and out of its seasons). A grown child of the House may also be
// matched with a townsperson (Heirs.marryTownsperson).
//
// Every roll is a hash of the person's uid — no draws on the shared RNG.
import { Relationships } from './_ref.js';
import { Utils, Townsfolk, House } from './_imports.js';

// Townsfolk temper → relationship personality and NPC traits
const PERSONALITY = {
    kind: 'kind', quiet: 'shy', bold: 'bold', witty: 'witty', jovial: 'passionate',
    stern: 'stoic', cautious: 'gentle', generous: 'kind', stubborn: 'ambitious', curious: 'bold',
};
const TRAITS = {
    kind: ['honest', 'generous'], quiet: ['homebody', 'serious'], bold: ['brave', 'adventurous'],
    witty: ['humorous', 'cunning'], jovial: ['humorous', 'romantic'], stern: ['serious', 'loyal'],
    cautious: ['cautious', 'practical'], generous: ['generous', 'loyal'], stubborn: ['loyal', 'practical'],
    curious: ['scholarly', 'adventurous'],
};
const OCCUPATION = {
    villager: 'artisan', farmer: 'farmer', merchant: 'merchant', guard: 'guard', priest: 'priest',
    blacksmith_npc: 'blacksmith', noble: 'noble', beggar: 'vagrant',
};

function _hash01(key) {
    return ((Utils.hashStr(key) >>> 0) % 100000) / 100000;
}

function _day(world) {
    return world && Number.isFinite(world.day) ? world.day : 0;
}

Object.assign(Relationships, {
    /** "q,r#id" for a person on a roster. */
    folkUid(folk, p) {
        return `${folk.q},${folk.r}#${p.id}`;
    },

    /** The roster and person behind a uid, or null. */
    folkPerson(world, uid) {
        const m = /^(-?\d+),(-?\d+)#(\d+)$/.exec(String(uid || ''));
        if (!m || !world || typeof world.getTile !== 'function') return null;
        const tile = world.getTile(Number(m[1]), Number(m[2]));
        const folk = tile && tile.settlement && tile.settlement.folk;
        const p = folk ? Townsfolk.get(folk, Number(m[3])) : null;
        return p ? { folk, p, settlement: tile.settlement, tile } : null;
    },

    /** The relationship NPC for a person, if the bridge has been crossed. */
    npcForPerson(folk, p) {
        if (!folk || !p) return null;
        const uid = Relationships.folkUid(folk, p);
        return Relationships._npcs.find(n => n.folkUid === uid) || null;
    },

    /**
     * Can this person become part of the player's life? Grown, alive, at home
     * (or already bridged), and no child.
     */
    canKnow(folk, p, world) {
        if (!folk || !p) return { ok: false, reason: 'No one to speak of.' };
        if (p.died != null) return { ok: false, reason: `${p.first} is dead.` };
        const C = Townsfolk.config();
        if (Townsfolk.age(p, _day(world)) < C.comeOfAge || p.role === 'child') return { ok: false, reason: `${p.first} is only a child.` };
        if (p.away && !p.away.withPlayer && !Relationships.npcForPerson(folk, p)) return { ok: false, reason: `${p.first} has gone to ${p.away.to}.` };
        return { ok: true };
    },

    /**
     * Cross the bridge: the relationship NPC for a townsperson, made once and
     * returned ever after. Their regard for the player starts from what they
     * already think of them (the dialog disposition, person.mem).
     */
    fromTownsperson(player, world, folk, p, settlement = null) {
        const can = Relationships.canKnow(folk, p, world);
        if (!can.ok) return { success: false, reason: can.reason };
        const existing = Relationships.npcForPerson(folk, p);
        if (existing) {
            Relationships._syncOne(player, world, existing, { folk, p, settlement });
            return { success: true, npc: existing, created: false };
        }
        const uid = Relationships.folkUid(folk, p);
        const temper = (p.traits || [])[0];
        const traits = [];
        for (const t of p.traits || []) for (const x of TRAITS[t] || []) if (!traits.includes(x)) traits.push(x);
        const hair = ['dark', 'blonde', 'red', 'brown', 'black'];
        const eyes = ['brown', 'blue', 'green', 'grey', 'hazel'];
        const build = ['slim', 'athletic', 'stocky', 'tall', 'sturdy'];
        const pick = (arr, salt) => arr[Math.floor(_hash01(`${uid}|${salt}`) * arr.length)];
        const town = settlement || (Relationships.folkPerson(world, uid) || {}).settlement || null;
        const npc = {
            id: `rnpc_${Relationships._nextId++}`,
            folkUid: uid,
            firstName: p.first,
            dynasty: p.last,
            gender: p.gender,
            age: Townsfolk.age(p, _day(world)),
            culture: 'Imperial',
            personality: PERSONALITY[temper] || 'gentle',
            settlementName: town ? town.name : '',
            settlementQ: folk.q,
            settlementR: folk.r,
            kingdomId: town ? town.kingdom || null : null,
            isAlive: true,
            traits: traits.slice(0, 3),
            appearance: { hair: pick(hair, 'hair'), eyes: pick(eyes, 'eyes'), build: pick(build, 'build') },
            occupation: OCCUPATION[p.retired || p.role] || 'artisan',
            affection: 0,
            friendship: 0,
            attraction: Math.round(20 + _hash01(`${uid}|attraction`) * 60),
            loyalty: 50,
            isMarried: false,
            isRomantic: false,
            metDay: _day(world),
            lastInteraction: _day(world),
        };
        Relationships._npcs.push(npc);
        p.rnpc = npc.id;
        // What they already think of the player becomes the start of the friendship
        if (player) {
            const rel = Relationships.getRelationship(player, npc.id);
            const disp = p.mem && Number.isFinite(p.mem.disposition) ? p.mem.disposition : 50;
            rel.score = Math.max(-100, Math.min(100, Math.round((disp - 50) * 0.8 + Math.min(10, (p.mem && p.mem.timesSpoken) || 0))));
            rel.history.push({ day: _day(world), action: 'met_in_town', result: town ? town.name : 'their town' });
            Relationships._syncOne(player, world, npc, { folk, p, settlement: town });
        }
        return { success: true, npc, created: true };
    },

    /** Their roster spouse, if living (they are not free to be courted). */
    _folkSpouse(folk, p) {
        const sp = Townsfolk.get(folk, p.spouse);
        return sp && sp.died == null ? sp : null;
    },

    /** Bring one bridged NPC and their person into step. */
    _syncOne(player, world, npc, got = null) {
        const found = got || Relationships.folkPerson(world, npc.folkUid);
        if (!found) return;
        player = player || {};
        const { folk, p } = found;
        const day = _day(world);
        // A death on either side is a death on both
        if (p.died != null && npc.isAlive) {
            npc.isAlive = false;
            npc.deathDay = p.died;
            npc.deathCause = p.cause;
            if (player.spouse === npc.id) {
                player.spouse = null;
                player.marriageDay = null;
                // Widowed: the Annals (systems/annals.js) tell it
                if (player.house) House._chronicle(player.house, world, `${npc.firstName}, ${npc.gender === 'male' ? 'husband' : 'wife'} of ${player.name}, dies${p.cause ? ` of ${p.cause}` : ''}.`, ['widowed']);
            }
        } else if (!npc.isAlive && p.died == null) {
            Townsfolk._die(folk, p, Number.isFinite(npc.deathDay) ? npc.deathDay : day, npc.deathCause || (p.away && p.away.withPlayer ? 'on the road' : 'misfortune'));
        }
        if (!npc.isAlive) {
            if (Array.isArray(player.travelParty)) player.travelParty = player.travelParty.filter(id => id !== npc.id);
            return;
        }
        npc.age = Townsfolk.age(p, day);
        npc.firstName = p.first;
        npc.dynasty = p.last;
        // Wed in town to someone else: not free to court
        const sp = Relationships._folkSpouse(folk, p);
        if (player.spouse === npc.id) {
            npc.marriedTo = null;
        } else if (sp) {
            npc.marriedTo = Townsfolk.name(sp);
        } else if (npc.marriedTo && !npc.marriedToOutsider) {
            npc.marriedTo = null;
        }
        // At home, or away with the player
        const wed = player.spouse === npc.id;
        const party = Array.isArray(player.travelParty) && player.travelParty.includes(npc.id);
        const withPlayer = wed ? 'wed' : (party ? 'party' : null);
        if (withPlayer) {
            if (!p.away || p.away.withPlayer !== withPlayer) {
                const name = player.firstName || player.name || 'a traveller';
                const to = withPlayer === 'wed' ? `wed to ${name}` : `the road with ${name}`;
                if (!p.away) Townsfolk._log(p, day, withPlayer === 'wed' ? 'wedPlayer' : 'leftWithPlayer', null, name);
                p.away = { d: day, to, withPlayer };
            }
        } else if (p.away && (p.away.withPlayer === 'wed' || p.away.withPlayer === 'party')) {
            // Dismissed, divorced or widowed of the player: home again
            Townsfolk._log(p, day, 'cameHome', null, p.away.to);
            p.away = null;
        }
    },

    /** Daily: keep every bridged NPC in step with their town's roster. */
    syncFolk(player, world) {
        if (!player || !world) return;
        for (const npc of Relationships._npcs) {
            if (!npc.folkUid || npc.folkDone) continue;
            Relationships._syncOne(player, world, npc);
            // Dead on both sides: nothing more to keep in step
            if (!npc.isAlive) npc.folkDone = true;
        }
    },

    /**
     * Grown, unwed townsfolk of a town with a roster, the people the player
     * has spoken with first — candidates for "Meet People" and local matches.
     */
    folkCandidates(world, folk, opts = {}) {
        if (!folk || !Array.isArray(folk.people)) return [];
        const day = _day(world);
        const C = Townsfolk.config();
        const out = folk.people.filter(p => Townsfolk.isHere(p) && p.role !== 'child' && p.role !== 'priest'
            && Townsfolk.age(p, day) >= C.comeOfAge
            && (opts.unwed ? !Relationships._folkSpouse(folk, p) : true)
            && (opts.gender ? p.gender === opts.gender : true)
            && (opts.minAge ? Townsfolk.age(p, day) >= opts.minAge : true)
            && (opts.maxAge ? Townsfolk.age(p, day) <= opts.maxAge : true)
            && !p.wedHouse);
        const known = p => (p.mem && p.mem.timesSpoken) || 0;
        out.sort((a, b) => known(b) - known(a) || a.id - b.id);
        return out;
    },
});
