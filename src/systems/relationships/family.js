// Relationships — family members (split from the original monolith).
import { Relationships } from './_ref.js';
import { DataLoader, Utils, Characters, House, Traits, Upbringing, Legacy, Townsfolk } from './_imports.js';
import { NPCLords } from '../../world/npcLords.js';
import { HeirAgency } from '../heirAgency.js';
import { Raising } from '../raising.js';
import { KinCrimes } from '../kinCrimes.js';
import { Regency } from '../regency.js';
import { PracticeSkills } from '../practiceSkills.js';
import { DynastyTree } from '../dynastyTree.js';
import { Heirlooms } from '../heirlooms.js';
import { Names } from '../../core/names.js';
import { Inheritance } from '../inheritance.js';
import { Vanishings } from '../vanishings.js';
import { Literacy } from '../literacy.js';

Object.assign(Relationships, {
    // ────────────────────────────────────────────────────────────────────
    //  Marriage effects & gifts (data/relationships.json)
    // ────────────────────────────────────────────────────────────────────
    /** marriageEffects with defaults for any missing field. */
    getMarriageEffects() {
        const data = Relationships._getData();
        return {
            staminaBonus: 1, happinessBonus: 10, reputationBonus: 5, renownGain: 3, allianceWithSpouseKingdom: true,
            ...((data && data.marriageEffects) || {}),
        };
    },

    /** The giftItems list (fallback: a single generic gift). */
    getGiftItems() {
        const data = Relationships._getData();
        if (data && Array.isArray(data.giftItems) && data.giftItems.length > 0) return data.giftItems;
        return [{ id: 'gift', name: 'Thoughtful Gift', icon: '🎁', cost: 25, affection: 8 }];
    },

    /** Personalities that especially prize a gift (×1.5 affection). */
    GIFT_TASTES: {
        sword: ['bold', 'stoic', 'ambitious'],
        poem: ['passionate', 'witty', 'shy'],
        book: ['witty', 'stoic', 'shy'],
        flowers: ['gentle', 'kind', 'shy'],
        jewelry: ['ambitious', 'passionate'],
        ring: ['passionate', 'ambitious', 'kind'],
    },

    /** Affection a gift is worth to this NPC. */
    giftValue(gift, npc) {
        const likes = Relationships.GIFT_TASTES[gift.id] || [];
        return (gift.affection || 0) * (npc && likes.includes(npc.personality) ? 1.5 : 1);
    },

    /**
     * The best gift the player can afford for this NPC: most affection,
     * cheaper on ties. Null when nothing is affordable.
     */
    chooseGift(player, npc) {
        let best = null;
        for (const gift of Relationships.getGiftItems()) {
            if ((gift.cost || 0) > (player.gold || 0)) continue;
            const v = Relationships.giftValue(gift, npc);
            if (!best || v > best.v || (v === best.v && (gift.cost || 0) < (best.gift.cost || 0))) best = { gift, v };
        }
        return best ? best.gift : null;
    },

    // ────────────────────────────────────────────────────────────────────
    //  Marriage
    // ────────────────────────────────────────────────────────────────────
    /**
     * Spend House Prestige to arrange a prestigious match: a noble of this
     * settlement, already well-disposed toward you, joins the people you can
     * court. Marrying them later brings extra renown and standing.
     */
    arrangeNobleMatch(player, tile, world) {
        if (player.spouse) return { success: false, reason: 'You are already married.' };
        if (!tile || !tile.settlement) return { success: false, reason: 'Matches are arranged in a settlement.' };
        const paid = House.arrangePrestigiousMarriage(player, world, {
            chronicle: `${player.house ? player.house.name : 'The House'} arranges a noble match in ${tile.settlement.name}.`,
            tags: ['marriage'],
        });
        if (!paid.success) {
            return { success: false, reason: paid.reason === 'Not enough Prestige' ? `Need ${paid.cost} Prestige (have ${paid.have}).` : paid.reason };
        }
        const npc = Relationships.generateNPC(tile.settlement, world);
        npc.occupation = 'noble';
        npc.noble = true;
        npc.attraction = Math.max(npc.attraction || 0, 90);
        npc.metDay = world ? world.day : 0;
        const rel = Relationships.getRelationship(player, npc.id);
        rel.affection = Math.max(rel.affection || 0, 60);
        rel.score = Math.max(rel.score || 0, 40);
        return { success: true, npc };
    },

    marry(player, npcId, world) {
        const npc = Relationships.getNPC(npcId);
        if (!npc) return { success: false, reason: 'NPC not found' };
        if (player.spouse) return { success: false, reason: 'Already married!' };

        const rel = Relationships.getRelationship(player, npcId);

        player.spouse = npcId;
        player.marriageDay = world ? world.day : 0;
        npc.isMarried = true;
        npc.isRomantic = true;
        // A townsperson leaves home to wed (./folk.js)
        if (npc.folkUid && world) Relationships._syncOne(player, world, npc);
        rel.affection = Math.max(rel.affection, 80);
        rel.romantic = true;

        // Marriage bonuses (data/relationships.json marriageEffects)
        const fx = Relationships.getMarriageEffects();
        player.maxStamina = (player.maxStamina || 10) + fx.staminaBonus;
        player.renown = (player.renown || 0) + fx.renownGain;
        // A newlywed's spirits lift
        if (fx.happinessBonus && typeof player.modifyNeed === 'function') {
            player.modifyNeed('social', fx.happinessBonus);
        }

        // Reputation with spouse's kingdom
        if (npc.kingdomId && player.reputation) {
            player.reputation[npc.kingdomId] = (player.reputation[npc.kingdomId] || 0) + fx.reputationBonus;
        }
        // The spouse's realm now counts you as kin: its lord's opinion of you
        // rises while the marriage lasts (NPCLords.getLordOpinion)
        player.marriageAllianceKingdom = fx.allianceWithSpouseKingdom && npc.kingdomId ? npc.kingdomId : null;

        // A noble match (arranged with Prestige) raises the House's standing
        if (npc.noble) {
            player.renown = (player.renown || 0) + 10;
            if (npc.kingdomId && player.reputation) {
                player.reputation[npc.kingdomId] = (player.reputation[npc.kingdomId] || 0) + 15;
            }
            if (npc.kingdomId && world) NPCLords.rememberRealm(world, npc.kingdomId, 'marriage_kin', { note: `${npc.firstName} ${npc.dynasty || ''}`.trim() });
            House.recordPlayerDeed(player, world, 'nobleMarriage', {
                reason: `married ${npc.firstName} ${npc.dynasty}`,
                chronicle: `${npc.firstName} of House ${npc.dynasty} marries into the family.`,
                tags: ['marriage'],
            });
        } else if (player.house) {
            // A love match: no Prestige, but the Annals (systems/annals.js) tell it
            House._chronicle(player.house, world, `${player.name} weds ${`${npc.firstName} ${npc.dynasty || ''}`.trim()}.`, ['marriage', 'love']);
        }

        return { success: true, npc, spouse: npc };
    },

    divorce(player, world) {
        if (!player.spouse) return { success: false, reason: 'Not married' };

        const npc = Relationships.getNPC(player.spouse);
        const rel = player.relationships[player.spouse];

        if (npc) {
            npc.isMarried = false;
            npc.isRomantic = false;
        }
        if (rel) {
            rel.affection = Math.max(0, rel.affection - 40);
            rel.score = Math.max(-100, rel.score - 30);
            rel.romantic = false;
        }

        player.spouse = null;
        player.marriageDay = null;
        player.karma = (player.karma || 0) - 5;
        player.renown = Math.max(0, (player.renown || 0) - 2);
        if (player.house && npc) House._chronicle(player.house, world, `${player.name} and ${npc.firstName} part; the marriage is ended.`, ['divorce']);

        return { success: true, exSpouse: npc };
    },

    // ────────────────────────────────────────────────────────────────────
    //  Children & Dynasty
    // ────────────────────────────────────────────────────────────────────
    /**
     * Check if a child could be born this year (called from endDay processing)
     */
    checkChildbirth(player, world) {
        if (!player.spouse) return null;
        const settings = Relationships._getHeirSettings();

        if ((player.children || []).filter(c => !c.isSibling).length >= settings.maxChildren) return null;

        const spouse = Relationships.getNPC(player.spouse);
        if (!spouse) return null;

        // Age checks
        const motherAge = player.gender === 'female' ? player.age : spouse.age;
        const fatherAge = player.gender === 'male' ? player.age : spouse.age;

        if (motherAge < settings.motherMinAge || motherAge > settings.motherMaxAge) return null;
        if (fatherAge < settings.fatherMinAge || fatherAge > (settings.fatherMaxAge ?? Infinity)) return null;

        // Only check once per year (roughly every daysPerYear days)
        if (world.day % settings.daysPerYear !== 0) return null;

        // Chance of child
        const rel = Relationships.getRelationship(player, player.spouse);
        const affectionBonus = (rel.affection || 50) / 200; // 0 to 0.5
        const chance = settings.childbirthChancePerYear + affectionBonus;

        if (Utils.random() > chance) return null;

        // Generate child!
        return Relationships.generateChild(player, spouse, world);
    },

    /**
     * A new child's first name: never a living brother's or sister's, nor a
     * parent's, nor that of anyone of the House's blood still living; now and
     * then (heirSettings.namesakeChance) the name of a forebear of the blood
     * who has died — the old name back in the House. ONE draw on the shared
     * RNG, as a plain pick always cost. Returns { firstName, namedFor:
     * { id, name }|null }.
     */
    _childName(player, spouse, pool, gender) {
        const first = n => String(n || '').split(' ')[0];
        const living = new Set();
        living.add(player.firstName || first(player.name));
        if (spouse) living.add(spouse.firstName || first(spouse.name));
        for (const c of player.children || []) if (c && c.isAlive !== false && c.firstName) living.add(c.firstName);
        const L = player.house && player.house.lineage;
        const forebears = [];
        for (const p of Object.values((L && L.people) || {})) {
            if (!p || !p.first) continue;
            if (p.alive !== false && p.died == null) { if (p.kind !== 'spouse') living.add(p.first); continue; }
            if (p.kind !== 'spouse' && (!p.gender || p.gender === gender)) forebears.push(p);
        }
        const r = Utils.random();
        const free = forebears.filter((p, i, a) => !living.has(p.first) && a.findIndex(o => o.first === p.first) === i);
        const hs = (DataLoader.relationships && DataLoader.relationships.heirSettings) || {};
        const chance = Number.isFinite(hs.namesakeChance) ? hs.namesakeChance : 0.25;
        if (free.length && r < chance) {
            const p = free[Math.min(free.length - 1, Math.floor((r / chance) * free.length))];
            return { firstName: p.first, namedFor: { id: p.id, name: p.name || p.first } };
        }
        const rest = free.length ? (r - chance) / (1 - chance) : r;
        const name = Names.pickFree(pool, rest, n => living.has(n)) || (gender === 'female' ? 'Helena' : 'Edmund');
        return { firstName: name, namedFor: null };
    },

    /** opts.quiet: no "is born" line in the House Chronicle (children counted in after the fact). */
    generateChild(player, spouse, world, opts = {}) {
        const culture = spouse.culture || 'Imperial';
        const gender = Utils.random() < 0.5 ? 'male' : 'female';

        const namePool = (typeof Characters !== 'undefined' && Characters.FIRST_NAMES[culture])
            ? Characters.FIRST_NAMES[culture]
            : { male: ['Edmund'], female: ['Helena'] };

        const { firstName, namedFor } = Relationships._childName(player, spouse, namePool[gender] || [], gender);

        // Roll traits for child
        const childTraits = Relationships._getChildTraits();
        const traits = [];
        for (const [id, trait] of Object.entries(childTraits)) {
            if (Utils.random() < trait.chance) {
                traits.push({ ...trait });
            }
        }

        const child = {
            id: `child_${Relationships._nextId++}`,
            firstName,
            dynasty: player.dynasty?.name || player.name,
            gender,
            age: 0,
            culture,
            birthDay: world ? world.day : 0,
            isAlive: true,
            traits,

            // Inherited base stats (blend of parents + random)
            strength: Math.floor(((player.strength || 5) + Utils.randInt(3, 7)) / 2),
            charisma: Math.floor(((player.charisma || 5) + Utils.randInt(3, 7)) / 2),
            intelligence: Math.floor(((player.intelligence || 5) + Utils.randInt(3, 7)) / 2),
            faith: Math.floor(((player.faith || 5) + Utils.randInt(3, 7)) / 2),
            luck: Math.floor(((player.luck || 5) + Utils.randInt(3, 7)) / 2),

            // Skills start at 0, grow as they age
            skills: {
                commerce: 0, combat: 0, leadership: 0,
                diplomacy: 0, stealth: 0, cartography: 0,
            },

            // Will be set when taking over as heir
            health: 100,
            maxHealth: 100,
        };

        // Apply trait effects
        for (const trait of traits) {
            if (trait.effects) {
                if (trait.effects.allStats) {
                    child.strength += trait.effects.allStats;
                    child.charisma += trait.effects.allStats;
                    child.intelligence += trait.effects.allStats;
                    child.faith += trait.effects.allStats;
                    child.luck += trait.effects.allStats;
                }
                if (trait.effects.strength) child.strength += trait.effects.strength;
                if (trait.effects.intelligence) child.intelligence += trait.effects.intelligence;
                if (trait.effects.charisma) child.charisma += trait.effects.charisma;
                if (trait.effects.luck) child.luck += trait.effects.luck;
                if (trait.effects.faith) child.faith += trait.effects.faith;
                if (trait.effects.maxHealth) child.maxHealth += trait.effects.maxHealth;
                if (trait.effects.combat) child.skills.combat += trait.effects.combat;
                if (trait.effects.stealth) child.skills.stealth += trait.effects.stealth;
                if (trait.effects.diplomacy) child.skills.diplomacy += trait.effects.diplomacy;
            }
        }

        if (namedFor) child.namedFor = namedFor;

        // Upbringing record (systems/upbringing.js) — focus, tutor, seeds of character
        Upbringing.ensure(child);

        if (!player.children) player.children = [];
        player.children.push(child);
        if (player.house && !opts.quiet) {
            const after = namedFor ? ` — named for ${namedFor.name}, of the House's blood` : '';
            House._chronicle(player.house, world, `${child.firstName} is born to ${player.name}${after}.`, ['heirs', 'birth']);
        }

        // Auto-designate first child as heir if no heir set
        if (!player.heir) {
            player.heir = child.id;
        }

        return child;
    },

    /**
     * Age children (called yearly)
     */
    ageChildren(player, world) {
        if (!player.children) return;
        // Growth in skills and stats comes from the child's upbringing
        // (systems/upbringing.js: focus, tutor and childhood events).
        for (const child of player.children) {
            if (!child.isAlive) continue;
            child.age++;
        }
    },

    // ────────────────────────────────────────────────────────────────────
    //  Player Aging & Death
    // ────────────────────────────────────────────────────────────────────
    /**
     * Process player aging (called every daysPerYear days)
     * Returns { aged, died, deathEvent } or null
     */
    processAging(player, world) {
        const settings = Relationships._getHeirSettings();
        if (world.day % settings.daysPerYear !== 0) return null;

        player.age++;
        // Age shapes practised skills: a milestone year is told (systems/practiceSkills.js)
        PracticeSkills.birthday(player);

        // Age all known NPCs (the spouse among them — once, not twice)
        const deaths = [];
        for (const npc of Relationships._npcs) {
            if (!npc.isAlive) continue;
            // An abdicated ruler of this House ages and dies by their own lifespan
            // (systems/abdication.js); one left behind by a new life ages as anyone
            if (npc.elder && player.abdication && Array.isArray(player.abdication.elders)
                && player.abdication.elders.some(e => e && e.alive && e.npcId === npc.id)) continue;
            if (npc.folkUid) {
                // A townsperson (./folk.js): their town's seasons age them and,
                // while they are at home, decide their death
                const f = Relationships.folkPerson(world, npc.folkUid);
                if (f) npc.age = Townsfolk.age(f.p, world.day);
                if (!(f && f.p.away && f.p.away.withPlayer)) continue;
            } else {
                npc.age++;
            }
            // NPC death (old age)
            if (npc.age > Utils.randInt(55, 85) && Utils.random() < 0.15) {
                npc.isAlive = false;
                npc.deathDay = world.day;
                npc.deathCause = 'old age';
                // Died on the road with the player: their family waits for word (systems/vanishings.js)
                if (Array.isArray(player.travelParty) && player.travelParty.includes(npc.id)) {
                    Vanishings.onPartyLoss(world, player, npc, { how: 'old_age', witnesses: Relationships.getTravelPartyMembers(player).filter(o => o.id !== npc.id) });
                }
                const rel = player.relationships && player.relationships[npc.id];
                if (player.spouse === npc.id || (rel && rel.score >= 20)) deaths.push(npc);
                if (player.spouse === npc.id) {
                    player.spouse = null;
                    player.marriageDay = null;
                    if (player.house) House._chronicle(player.house, world, `${npc.firstName}, ${npc.gender === 'male' ? 'husband' : 'wife'} of ${player.name}, dies of old age.`, ['widowed']);
                }
            }
        }

        // Age children
        Relationships.ageChildren(player, world);

        // Player death check
        if (player.age > player.maxLifespan) {
            const yearsOver = player.age - player.maxLifespan;
            const deathChance = yearsOver * settings.deathChancePerYearOverMax;
            if (Utils.random() < deathChance) {
                return { aged: true, died: true, age: player.age, deaths };
            }
        }

        // Health deterioration in old age
        if (player.age > 50) {
            const healthLoss = Math.floor((player.age - 50) * 0.5);
            player.maxHealth = Math.max(50, 100 - healthLoss);
            if (player.health > player.maxHealth) {
                player.health = player.maxHealth;
            }
        }

        return { aged: true, died: false, age: player.age, deaths };
    },

    // ────────────────────────────────────────────────────────────────────
    //  Heir System
    // ────────────────────────────────────────────────────────────────────
    /**
     * Get eligible heirs from children
     */
    getEligibleHeirs(player) {
        if (!player.children) return [];
        const settings = Relationships._getHeirSettings();
        // The ruler's own children first (eldest first), then siblings kept from the last succession
        // (a child declared unfit to rule — systems/kinCrimes.js — is never offered the seat)
        return player.children.filter(c => c.isAlive && c.age >= settings.minAgeToPlay && !(c.kin && c.kin.unfit))
            .sort((a, b) => (a.isSibling ? 1 : 0) - (b.isSibling ? 1 : 0) || (b.age || 0) - (a.age || 0));
    },

    /**
     * Set the designated heir
     */
    designateHeir(player, childId) {
        const child = (player.children || []).find(c => c.id === childId);
        if (!child) return { success: false, reason: 'Child not found' };
        if (!child.isAlive) return { success: false, reason: 'That child has passed away' };
        if (child.kin && child.kin.unfit) return { success: false, reason: `${child.firstName} has been declared unfit to rule` };

        player.heir = childId;
        return { success: true, heir: child };
    },

    /**
     * Take over as an heir — creates a new player from the child's stats
     * Returns the transformed player data
     */
    /**
     * The heir's match (alliance or royal, made while they were a child of the
     * House) becomes the new ruler's spouse: a real NPC, with the spouse's
     * realm counting the House as kin, as a marriage made in person does.
     */
    _seatHeirSpouse(player, child, world) {
        const sp = child && child.upbringing && child.upbringing.spouse;
        if (!sp || !world) return null;
        // A match made in town (Heirs.marryTownsperson): the townsperson themself
        if (sp.kind === 'local' && sp.folkUid) {
            const f = Relationships.folkPerson(world, sp.folkUid);
            const res = f ? Relationships.fromTownsperson(null, world, f.folk, f.p, f.settlement) : null;
            if (!res || !res.success) return null;
            const npc = res.npc;
            npc.isMarried = true;
            npc.marriedTo = null;
            player.spouse = npc.id;
            player.marriageDay = sp.day != null ? sp.day : ((world && world.day) || 0);
            player.marriageAllianceKingdom = null;
            const rel = Relationships.getRelationship(player, npc.id);
            rel.affection = Math.max(rel.affection || 0, 70);
            rel.score = Math.max(rel.score || 0, 40);
            rel.romantic = true;
            return npc;
        }
        const k = sp.kingdomId && typeof world.getKingdom === 'function' ? world.getKingdom(sp.kingdomId) : null;
        const home = k && k.capital ? world.getTile(k.capital.q, k.capital.r) : null;
        const settlement = (home && home.settlement) || { name: sp.kingdomName || 'abroad', kingdom: sp.kingdomId || null };
        const npc = Relationships.generateNPC(settlement, world);
        const [first, ...rest] = String(sp.name || npc.firstName).split(' ');
        npc.firstName = first;
        if (rest.length && sp.kind === 'royal') npc.dynasty = rest.join(' ');
        npc.gender = child.gender === 'female' ? 'male' : 'female';
        npc.age = Math.max(16, (child.age || 18) + Utils.randInt(-3, 3));
        npc.isMarried = true;
        npc.noble = true;
        // A royal spouse keeps the link every reader expects (Throne claims by marriage,
        // RealmIntel kin at court): { kingdomId, charId, dynasty }, as Throne's own royal match makes
        npc.royal = sp.kind === 'royal' ? { kingdomId: sp.kingdomId || null, charId: sp.royalId != null ? sp.royalId : null, dynasty: npc.dynasty || null } : false;
        if (sp.royalId) npc.royalId = sp.royalId;
        player.spouse = npc.id;
        player.marriageDay = sp.day != null ? sp.day : ((world && world.day) || 0);
        const fx = Relationships.getMarriageEffects();
        player.marriageAllianceKingdom = fx.allianceWithSpouseKingdom && sp.kingdomId ? sp.kingdomId : null;
        const rel = Relationships.getRelationship(player, npc.id);
        rel.affection = Math.max(rel.affection || 0, 60);
        rel.romantic = true;
        return npc;
    },

    /**
     * The children a married heir already has when they take up the mantle:
     * one chance a year (heirSettings.heirOwnChildChance) for each year of
     * the marriage in which both were of an age to have them, up to
     * maxChildren. They join as the new ruler's own children, of the age
     * they would be now. Without them a line could only go on through the
     * ruler's late children, and an heir who inherits at fifty has none.
     */
    _heirsOwnChildren(player, child, spouse, world) {
        const sp = child && child.upbringing && child.upbringing.spouse;
        if (!sp || !world) return [];
        // A spouse since dead or gone (a townsperson who died before the heir
        // inherited) still had the children: born of the marriage, not of today
        const parent = spouse || { culture: player.culture || child.culture, age: player.age };
        const settings = Relationships._getHeirSettings();
        const Y = settings.daysPerYear || 120;
        const chance = typeof settings.heirOwnChildChance === 'number' ? settings.heirOwnChildChance : 0.35;
        const yearsWed = Math.floor(Math.max(0, (world.day || 0) - (sp.day || 0)) / Y);
        const born = [];
        for (let ago = yearsWed; ago >= 1; ago--) {
            if ((player.children || []).filter(c => !c.isSibling).length >= settings.maxChildren) break;
            const heirAge = player.age - ago;
            const spouseAge = (parent.age || player.age) - ago;
            const mother = player.gender === 'female' ? heirAge : spouseAge;
            const father = player.gender === 'male' ? heirAge : spouseAge;
            if (mother < settings.motherMinAge || mother > settings.motherMaxAge) continue;
            if (father < settings.fatherMinAge || father > (settings.fatherMaxAge ?? Infinity)) continue;
            if (Utils.random() > chance) continue;
            const kid = Relationships.generateChild(player, parent, world, { quiet: true });
            kid.age = ago;
            kid.birthDay = (world.day || 0) - ago * Y;
            if (kid.age >= settings.minAgeToPlay && kid.upbringing) kid.upbringing.comeOfAge = true;
            born.push(kid);
        }
        if (born.length && player.house) {
            House._chronicle(player.house, world, `${player.firstName} comes to the seat with ${born.length === 1 ? 'a child' : `${born.length} children`} of their own: ${born.map(k => k.firstName).join(', ')}.`, ['heirs', 'birth']);
        }
        return born;
    },

    succeedAsHeir(player, childId, world, opts = {}) {
        const settings = Relationships._getHeirSettings();
        const child = (player.children || []).find(c => c.id === childId);

        if (!child || !child.isAlive) {
            return { success: false, reason: 'Invalid heir' };
        }
        // An under-age heir reigns under a regent (systems/regency.js) — the
        // player plays the child's court until majority; the House pays the
        // regency's stiff cost in House.processSuccession below. The regent is
        // chosen from the late ruler's household before it is cleared.
        const minorReign = !!opts.regency && child.age < settings.minAgeToPlay;
        const regent = minorReign ? Regency.pick(player, world, childId, opts.regent || null) : null;
        if (!minorReign && child.age < settings.minAgeToPlay) {
            return { success: false, reason: `Heir must be at least ${settings.minAgeToPlay} years old` };
        }

        // Store old player info for history
        const oldName = player.name;
        const oldAge = player.age;
        // The family tree takes its last look at the late ruler's household (systems/dynastyTree.js)
        const npcLookup = id => Relationships.getNPC(id);
        if (player.house) DynastyTree.sync(player, world, { npc: npcLookup });
        // File the late ruler's reign in the House Chronicle (systems/legacy.js)
        const reign = player.house ? Legacy.closeReign(player, world, { cause: opts.cause || null }) : null;

        // Transfer heir stats to player
        player.firstName = child.firstName;
        player.lastName = child.dynasty || '';
        player.name = `${child.firstName} ${child.dynasty}`;
        player.gender = child.gender;
        player.age = child.age;
        player.title = `Heir of ${oldName}`;

        // Stats — child's developed stats
        player.strength = child.strength || 5;
        player.charisma = child.charisma || 5;
        player.intelligence = child.intelligence || 5;
        player.faith = child.faith || 5;
        player.luck = child.luck || 5;

        // Skills — child learned some, plus base
        player.skills = {
            commerce: Math.max(1, child.skills?.commerce || 0),
            combat: Math.max(1, child.skills?.combat || 0),
            leadership: Math.max(1, child.skills?.leadership || 0),
            diplomacy: Math.max(1, child.skills?.diplomacy || 0),
            stealth: Math.max(1, child.skills?.stealth || 0),
            cartography: child.skills?.cartography || 0,
        };
        // Their letters, learned at home and from their tutors (systems/literacy.js)
        Literacy.takeHeir(player, child);
        // The late ruler's wounds and sickness die with them (stats above are
        // the heir's own, so nothing is given back) — systems/ailments.js
        if (player.ailments && Array.isArray(player.ailments.list)) {
            player.ailments.list = [];
            player.ailments.party = {};
            player.ailments.deathCause = null;
        }
        if (player.delves && Array.isArray(player.delves.injuries)) player.delves.injuries = [];

        // Health — full for young heir
        player.health = child.maxHealth || 100;
        player.maxHealth = child.maxHealth || 100;
        player.stamina = 10;
        player.maxStamina = 10;
        // (the heir was fed: the late ruler's hunger and its count of starving days die with them)
        player.starvationDays = 0;
        if (player.needs && typeof player.needs === 'object') player.needs.hunger = Math.max(Number(player.needs.hunger) || 0, 80);

        // Inheritance — partial gold, renown, reputation. What the heir does
        // not keep of the coin pays the late ruler's debts, the other
        // children's portions and the heriot to the liege crown (systems/inheritance.js):
        // every coin goes into a real purse. Dead children's portions come home first.
        Inheritance.reclaimPortions(player);
        const inheritance = Inheritance.settle(player, world, {
            // (an abdication passes the purse whole: opts.keepShare 1 — systems/abdication.js)
            keepShare: opts.keepShare != null ? opts.keepShare : settings.inheritanceGoldPercent, heirId: childId, npc: id => Relationships.getNPC(id),
        });
        // ...and the heir's own portion, if one was set aside for them, joins the purse
        if (child.purse > 0) {
            Inheritance.setCoin(player, Inheritance.coin(player) + child.purse);
            child.purse = 0;
        }
        if (player.house && inheritance.line) House._chronicle(player.house, world, inheritance.line, ['heirs', 'inheritance']);
        player.renown = Math.floor((player.renown || 0) * (opts.renownShare != null ? opts.renownShare : settings.inheritanceRenownPercent));

        // Reputation partially inherited
        for (const kId of Object.keys(player.reputation || {})) {
            player.reputation[kId] = Math.floor(player.reputation[kId] * (opts.reputationShare != null ? opts.reputationShare : settings.inheritanceReputationPercent));
        }

        // Reset karma
        player.karma = 0;

        // New lifespan
        player.maxLifespan = Utils.randInt(settings.playerMaxLifespan.min, settings.playerMaxLifespan.max);

        // Keep dynasty, clear personal relationships
        player.spouse = null;
        player.marriageDay = null;
        player.marriageAllianceKingdom = null;
        player.heir = null;
        // The late ruler's errands end with them (a survey in hand, cartography/charting.js)
        player.autoChart = null;

        // Remove this child from children, keep others as siblings (marked: they
        // are not the new ruler's own children, and don't count against having them)
        player.children = player.children.filter(c => c.id !== childId);
        for (const c of player.children) c.isSibling = true;

        // Keep properties, army, religion — and the packs: the late ruler's
        // goods pass to the heir (nothing is made or lost; at the dawn they
        // are the purse in kind, world/barter.js)
        if (!player.inventory || typeof player.inventory !== 'object') player.inventory = {};
        player.allegiance = null;
        player.kingdomTitle = null;

        // An heir taking up the mantle is a notable deed for the House
        // (House prestige superseded the legacy player.dynasty.prestige counter)
        if (typeof House !== 'undefined' && player.house) {
            House.award(player.house, 5, 'an heir takes up the mantle', world ? world.day : 0);
        }

        // Clear old relationships (new character doesn't know the same people personally)
        player.relationships = {};

        // An heir already wed (systems/heirs.js matches) brings their spouse to the throne
        const heirSpouse = Relationships._seatHeirSpouse(player, child, world);
        // ...and the children born to them in the years they were wed
        const ownChildren = Relationships._heirsOwnChildren(player, child, heirSpouse, world);

        // House-level succession stakes: advance the generation, possibly a
        // disputed succession (securable with Prestige, else holdings fragment).
        let houseResult = null;
        if (typeof House !== 'undefined' && player.house) {
            houseResult = House.processSuccession(player, world, {
                headId: player.id,
                secure: !!opts.secure,
                regency: !!opts.regency,
                // (an abdication with the old ruler's blessing is seldom disputed)
                disputeChance: opts.disputeChance,
            });
        }

        // Traits are not inherited; the House remembers the strongest two
        const traitEcho = Traits.onSuccession(player, world, oldName);
        // ...but the heir brings the character their upbringing gave them
        const heirTraits = Upbringing.applyHeirTraits(player, child, world);
        // ...and the life they lived before the throne: fosterings, commands,
        // embassies, a marriage — lords' memories, standing, Prestige (systems/heirAgency.js)
        const heirRecord = HeirAgency.onSuccession(player, world, child);
        // ...and the account of their childhood: the ruler's education (systems/raising.js)
        const heirEducation = Raising.onSuccession(player, world, child);
        // ...and what they remember of the late ruler's crimes against the blood (systems/kinCrimes.js)
        KinCrimes.onSuccession(player, world, child);
        // A child on the throne reigns under a regent (systems/regency.js)
        player.regency = null;
        const regency = minorReign ? Regency.begin(player, world, regent) : null;
        if (player.house) {
            for (const r of House.ROLE_IDS) {
                if (player.house.roles && player.house.roles[r] === childId) player.house.roles[r] = null;
            }
            Legacy.openReign(player, world);
            // The tree closes the late ruler; the heirlooms pass to the heir
            // (systems/dynastyTree.js, systems/heirlooms.js)
            DynastyTree.onSuccession(player, world, { heirId: childId, reign, cause: opts.cause || null, npc: npcLookup });
            Heirlooms.onSuccession(player, world, {
                oldName, heirId: childId, heirName: player.name, cause: opts.cause || (reign && reign.cause) || null,
                disputed: !!(houseResult && houseResult.disputed), secured: !!(houseResult && houseResult.secured),
                regent: regency && regency.regent ? regency.regent.name : null,
            });
        }

        return {
            success: true,
            oldName,
            oldAge,
            newName: player.name,
            heir: child,
            house: houseResult,
            traitEcho,
            heirTraits,
            heirRecord,
            heirEducation,
            regency,
            reign,
            ownChildren,
            inheritance,
        };
    },

    // ────────────────────────────────────────────────────────────────────
    //  NPC-Initiated Events (called in endDay)
    // ────────────────────────────────────────────────────────────────────
    /**
     * Process daily relationship events
     * Returns array of event notifications
     */
    processDailyEvents(player, world) {
        const events = [];

        Relationships.cleanupTravelParty(player);
        // A child who died leaves their portion to the House purse (systems/inheritance.js)
        Inheritance.reclaimPortions(player);

        // Marriage events
        if (player.spouse) {
            const data = Relationships._getData();
            const marriageEvents = data?.marriageEvents || [];
            for (const evt of marriageEvents) {
                if (evt.requiresChildren && (!player.children || player.children.length === 0)) continue;
                if (Utils.random() < (evt.chance || 0)) {
                    const spouse = Relationships.getNPC(player.spouse);
                    if (!spouse) continue;

                    const rel = Relationships.getRelationship(player, player.spouse);
                    rel.affection = Math.max(0, Math.min(100, rel.affection + (evt.value || 0)));

                    let text = evt.text
                        .replace('{spouse}', spouse.firstName)
                        .replace('{child}', player.children?.length > 0 ? player.children[player.children.length - 1].firstName : 'your child');

                    events.push({ type: 'marriage', text, impact: evt.value > 0 ? 'positive' : 'negative' });
                }
            }
        }

        // NPC-initiated courting events for NPCs the player knows
        const data = Relationships._getData();
        const courtEvents = data?.npcCourtEvents || [];
        for (const [npcId, rel] of Object.entries(player.relationships || {})) {
            if (!rel.romantic) continue;
            const npc = Relationships.getNPC(npcId);
            if (!npc || !npc.isAlive) continue;

            for (const evt of courtEvents) {
                if (Utils.random() < (evt.chance || 0)) {
                    let text = evt.text
                        .replace('{npc}', npc.firstName)
                        .replace('{item}', Utils.randPick(['pressed flower', 'carved charm', 'ribbon', 'sweet cake']));

                    if (evt.affectionGain) {
                        rel.affection = Math.max(0, Math.min(100, (rel.affection || 0) + evt.affectionGain));
                    }
                    if (evt.relationGain) {
                        rel.score = Math.max(-100, Math.min(100, (rel.score || 0) + evt.relationGain));
                    }

                    events.push({ type: 'court', text, npc: npc.firstName });
                    break; // One event per NPC per day
                }
            }
        }

        // Childbirth check
        const newChild = Relationships.checkChildbirth(player, world);
        if (newChild) {
            const traitStr = newChild.traits.length > 0
                ? ` Traits: ${newChild.traits.map(t => `${t.icon} ${t.name}`).join(', ')}`
                : '';
            events.push({
                type: 'childbirth',
                text: `🎉 A ${newChild.gender === 'male' ? 'son' : 'daughter'} has been born! Welcome ${newChild.firstName} ${newChild.dynasty}!${traitStr}`,
                child: newChild,
            });
        }

        // Relationship decay for NPCs not interacted with recently
        for (const [npcId, rel] of Object.entries(player.relationships || {})) {
            const npc = Relationships.getNPC(npcId);
            if (!npc || !npc.isAlive) continue;

            // Slow decay if not interacted in a while
            const daysSinceInteraction = (world?.day || 0) - (npc.lastInteraction || 0);
            if (daysSinceInteraction > 30 && Utils.random() < 0.05) {
                if (rel.score > 0) rel.score = Math.max(0, rel.score - 1);
                if (rel.affection > 0 && !npc.isMarried) rel.affection = Math.max(0, rel.affection - 1);
            }
        }

        // Loans, confidences, pleas, rival suitors, rumours, jealousy, grudges (./matters.js)
        events.push(...Relationships.processMatters(player, world));

        return events;
    },

    // ────────────────────────────────────────────────────────────────────
    //  Save / Load Support
    // ────────────────────────────────────────────────────────────────────
    /**
     * Get serializable state for saving
     */
    getState() {
        return {
            npcs: Relationships._npcs,
            nextId: Relationships._nextId,
        };
    },

    /**
     * Restore state from save data
     */
    loadState(state, player) {
        if (state) {
            Relationships._npcs = state.npcs || [];
            Relationships._nextId = state.nextId || 1;
        }
        // Also restore from player for backward compat
        if (player._relationshipNpcs) {
            Relationships._npcs = player._relationshipNpcs;
        }
        if (player._relationshipNextId) {
            Relationships._nextId = player._relationshipNextId;
        }
    },

    /**
     * Store state on player before saving
     */
    prepareForSave(player) {
        player._relationshipNpcs = Relationships._npcs;
        player._relationshipNextId = Relationships._nextId;
    },
});
