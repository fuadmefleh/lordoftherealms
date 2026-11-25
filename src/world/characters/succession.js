// Characters — succession members (split from the original monolith).
import { Characters } from './_ref.js';
import { Utils } from './_imports.js';
import { Names } from '../../core/names.js';
import { CrownBooks } from '../crownBooks.js';
import { Economy } from '../economy.js';

/** Dead royal children kept this many days (the court still mourns them), then dropped. */
const FAMILY_MOURN_DAYS = 360;
/** Dynasty member ids kept (only used to avoid listing a member twice). */
const FAMILY_MEMBERS_CAP = 120;

Object.assign(Characters, {
    /**
     * Keep a royal family's records from growing for ever over a long game:
     * every child ever born stayed in data.children, and every birth linked
     * itself to every living sibling (and cousin), so the lists grew without
     * end and quadratically. Living children are all kept; the dead are kept
     * for FAMILY_MOURN_DAYS, never one married to the player (throne.js finds
     * the royal spouse here). Dropped ids leave the living's sibling lists.
     */
    pruneFamily(data, day) {
        if (!data || !Array.isArray(data.children)) return;
        const now = Number.isFinite(day) ? day : 0;
        // A death recorded without a day (other systems' killings) starts its mourning now
        for (const c of data.children) if (c && !c.isAlive && !Number.isFinite(c.deathDay)) c.deathDay = now;
        const kept = data.children.filter(c => c && (c.isAlive || c.spouseId === 'player' || now - c.deathDay < FAMILY_MOURN_DAYS));
        if (kept.length !== data.children.length) {
            const ids = new Set(kept.map(c => c.id));
            for (const c of kept) {
                if (Array.isArray(c.siblingIds)) c.siblingIds = c.siblingIds.filter(id => ids.has(id));
            }
            data.children = kept;
        }
        const members = data.dynasty && data.dynasty.members;
        if (Array.isArray(members) && members.length > FAMILY_MEMBERS_CAP) {
            const rulerId = data.ruler && data.ruler.id;
            const recent = members.slice(-FAMILY_MEMBERS_CAP);
            data.dynasty.members = rulerId && !recent.includes(rulerId) ? [rulerId, ...recent.slice(1)] : recent;
        }
    },

    // ────────────────────────────────────────────────────────────────────
    //  The ruler's name and record; royals across two realms
    // ────────────────────────────────────────────────────────────────────
    /**
     * The one writer of a realm's displayed ruler: kingdom.ruler (and its
     * lord's name) read the royal record, characterData.ruler. Every system
     * that puts a new ruler on a throne sets the record and calls this, so the
     * name shown and the family records never part. (A junior realm in
     * personal union reads its monarch's name instead: systems/realmUnions.js
     * keeps that.)
     */
    syncRulerName(kingdom) {
        const r = kingdom && kingdom.characterData && kingdom.characterData.ruler;
        if (!r) return kingdom ? kingdom.ruler : null;
        kingdom.ruler = Characters.getDisplayName(r, kingdom);
        if (kingdom.lord) kingdom.lord.name = kingdom.ruler;
        return kingdom.ruler;
    },

    /**
     * May these two royals wed? The world's rule, as the betrothals keep it
     * (systems/betrothals.js: a match is always made with the other sex): a
     * man and a woman, both living, neither the other.
     */
    canWed(a, b) {
        return !!(a && b && a !== b && a.isAlive !== false && b.isAlive !== false
            && (a.gender === 'male' || a.gender === 'female') && (b.gender === 'male' || b.gender === 'female') && a.gender !== b.gender);
    },

    /** A royal by id in any living realm's records (skipping `except`): { char, home } or null. */
    _findAnywhere(world, id, except = null) {
        if (!world || id == null) return null;
        for (const k of world.kingdoms || []) {
            if (!k || k === except || !k.isAlive || !k.characterData) continue;
            const c = Characters._findCharacter(k, id);
            if (c) return { char: c, home: k };
        }
        return null;
    },

    /** Does this royal ({ char, home }) wear the crown of the realm whose records hold them? */
    _reigns(f) {
        return !!(f && f.home && f.home.characterData && f.home.characterData.ruler === f.char && f.char.isAlive !== false);
    },

    /** A royal raised abroad comes home to reign: their record moves into this realm's. */
    _takeHome(kingdom, f) {
        const c = f.char;
        if (f.home && f.home !== kingdom && f.home.characterData) {
            const d = f.home.characterData;
            if (Array.isArray(d.children)) d.children = d.children.filter(x => x !== c);
            if (d.spouse === c) d.spouse = null;
            c.kingdomId = kingdom.id;
        }
        return c;
    },

    /**
     * The line of a royal: their living children of age (16), eldest first —
     * those raised here and those raised at another realm's court (a child of
     * a royal marriage across two realms is of both lines). → [{ char, home }]
     */
    _lineOf(world, kingdom, parent) {
        const out = [];
        const seen = new Set();
        for (const id of (parent && parent.childrenIds) || []) {
            if (seen.has(id)) continue;
            seen.add(id);
            const local = Characters._findCharacter(kingdom, id);
            const f = local ? { char: local, home: kingdom } : Characters._findAnywhere(world, id, kingdom);
            if (!f || !f.char || !f.char.isAlive || !(f.char.age >= 16)) continue;
            if (f.home !== kingdom && f.char.isPlayer) continue;
            out.push(f);
        }
        return out.sort((a, b) => b.char.age - a.char.age);
    },

    /**
     * A ruler's living spouse in another realm's records (a royal marriage
     * across two realms): { char, home } or null.
     */
    _spouseAbroad(world, kingdom, ruler) {
        if (!ruler || typeof ruler.spouseId !== 'string' || ruler.spouseId.startsWith('player')) return null;
        const f = Characters._findAnywhere(world, ruler.spouseId, kingdom);
        if (!f || f.char.spouseId !== ruler.id || f.char.isPlayer || !Characters.canWed(ruler, f.char)) return null;
        return f;
    },

    /**
     * Are a cross-realm couple's children born at this court? One court rolls
     * for them, never both: a ruler wed to a foreign prince(ss) has them at
     * home; two reigning spouses at the senior court of their union, else at
     * the father's.
     */
    _birthsHere(kingdom, ruler, f) {
        if (!Characters._reigns(f)) return true;
        const u = kingdom.personalUnion;
        if (u && String(u.partnerId) === String(f.home.id)) return u.role === 'senior';
        return ruler.gender === 'male';
    },

    /** The ruler's partner for an heir: the consort at court, or a spouse who lives abroad. → { partner, abroad } */
    _heirPartner(world, kingdom) {
        const data = kingdom.characterData;
        const ruler = data && data.ruler;
        if (!ruler) return null;
        if (data.spouse && data.spouse.isAlive && data.spouse !== ruler) return { partner: data.spouse, abroad: null };
        if (data.spouse && data.spouse.isAlive) return null;
        const f = Characters._spouseAbroad(world, kingdom, ruler);
        if (f && Characters._birthsHere(kingdom, ruler, f)) return { partner: f.char, abroad: f.home };
        return null;
    },

    // ────────────────────────────────────────────────────────────────────
    //  Succession System
    // ────────────────────────────────────────────────────────────────────
    /**
     * Handle ruler death and succession
     */
    handleSuccession(kingdom, world) {
        const charData = kingdom.characterData;
        if (!charData) return;

        const oldRuler = charData.ruler;
        const oldRulerName = Characters.getDisplayName(oldRuler, kingdom);
        oldRuler.isAlive = false;
        oldRuler.isRuler = false;
        oldRuler.deathDay = world.day;

        // Find heir (eldest living child first, then spouse, then random dynasty member)
        let heir = null;
        let successionType = 'normal';
        // The heir by blood who already reigns in another realm (a child of a
        // royal marriage across two realms): one at home holds the court for them
        let abroad = null;

        // Whose line: a stand-in's (one who held the court for an heir abroad)
        // passes back to the one they stood for, or to that one's own children
        let lineHead = oldRuler;
        const si = oldRuler.standIn;
        if (si && si.forId != null) {
            const p = Characters._findAnywhere(world, si.forId, null);
            if (p && p.char.isAlive && !p.char.isPlayer) {
                if (p.home !== kingdom && Characters._reigns(p)) abroad = p;
                else { heir = Characters._takeHome(kingdom, p); successionType = 'heir'; }
            } else if (p && !p.char.isAlive) lineHead = p.char;
        }

        // Eldest eligible child (wherever they were raised: a child born at the
        // other parent's court keeps their place in this line)
        if (!heir && !abroad && Array.isArray(lineHead.childrenIds) && lineHead.childrenIds.length > 0) {
            const line = Characters._lineOf(world, kingdom, lineHead);
            if (line.length > 0) {
                if (line[0].home !== kingdom && Characters._reigns(line[0])) abroad = line[0];
                else {
                    heir = Characters._takeHome(kingdom, line[0]);
                    successionType = 'heir';
                }
            }
        }

        // An heir abroad: the next of the blood not reigning elsewhere holds the
        // court (else the late ruler's consort, else a kinsman), styled the
        // heir's stand-in. Whether the crown goes abroad is the realm's law to
        // say (systems/realmUnions.js reads lastSuccession.abroad); where it
        // will not, the stand-in is crowned in their own right.
        if (abroad) {
            const from = abroad.char.id === (si && si.forId) ? abroad.char : lineHead;
            const next = Characters._lineOf(world, kingdom, from).find(f => f.char !== abroad.char && !(f.home !== kingdom && Characters._reigns(f)));
            if (next) heir = Characters._takeHome(kingdom, next);
            else if (charData.spouse && charData.spouse.isAlive && charData.spouse !== oldRuler && !charData.spouse.isPlayer) heir = charData.spouse;
            else {
                heir = Characters.generateCharacter({
                    culture: kingdom.culture,
                    age: Utils.randInt(25, 45),
                    dynasty: charData.dynasty.name,
                    isRuler: true,
                });
                heir.kingdomId = kingdom.id;
            }
            heir.standIn = { forId: abroad.char.id, seatId: abroad.home.id, day: world.day };
            successionType = 'heir';
        }

        // Spouse as regent
        if (!heir && charData.spouse && charData.spouse.isAlive) {
            heir = charData.spouse;
            successionType = 'regent';
        }

        // Random dynasty member
        if (!heir) {
            heir = Characters.generateCharacter({
                culture: kingdom.culture,
                age: Utils.randInt(20, 40),
                dynasty: charData.dynasty.name,
                isRuler: true,
            });
            heir.kingdomId = kingdom.id;
            successionType = 'distant_relative';
        }

        // Succession crisis chance
        let crisisOccurred = false;
        if (successionType === 'distant_relative' || (successionType === 'regent' && Utils.random() < 0.3)) {
            crisisOccurred = Characters._triggerSuccessionCrisis(kingdom, heir, world);
        }

        // Install new ruler
        if (!abroad && heir.standIn) delete heir.standIn;
        heir.isRuler = true;
        charData.ruler = heir;
        charData.dynasty.bloodline.push(heir.id);
        if (!charData.dynasty.members.includes(heir.id)) {
            charData.dynasty.members.push(heir.id);
        }

        // Update kingdom ruler name (and the lord's: Characters.syncRulerName)
        Characters.syncRulerName(kingdom);

        // Generate new spouse if heir is unmarried
        if (!heir.spouseId) {
            if (Utils.random() < 0.5) {
                const spouseGender = heir.gender === 'male' ? 'female' : 'male';
                const newSpouse = Characters.generateCharacter({
                    culture: Utils.random() < 0.7 ? kingdom.culture : Utils.randPick(Object.keys(Characters.FIRST_NAMES)),
                    gender: spouseGender,
                    age: Utils.randInt(heir.age - 5, heir.age + 5),
                    dynasty: Utils.randPick(Characters.DYNASTY_NAMES[kingdom.culture] || Characters.DYNASTY_NAMES.Imperial),
                });
                newSpouse.kingdomId = kingdom.id;
                heir.spouseId = newSpouse.id;
                newSpouse.spouseId = heir.id;
                charData.spouse = newSpouse;
                charData.dynasty.members.push(newSpouse.id);
            } else {
                charData.spouse = null;
            }
        } else {
            // Find spouse in existing characters
            const existingSpouse = Characters._findCharacter(kingdom, heir.spouseId);
            charData.spouse = existingSpouse;
        }

        // Update the NPC Lord data to stay in sync
        if (kingdom.lord) kingdom.lord.age = heir.age;

        // Event
        const eventText = crisisOccurred
            ? `👑 Succession Crisis in ${Names.realm(kingdom.name)}! ${oldRulerName} has died. After a disputed succession, ${Characters.getFullName(heir)} seizes power.`
            : abroad
                ? `👑 ${oldRulerName} of ${Names.realm(kingdom.name)} has died at age ${oldRuler.age}. The heir by blood, ${Characters.getDisplayName(abroad.char, abroad.home)}, reigns in ${Names.realm(abroad.home.name)}; ${Characters.getFullName(heir)} holds the court of ${Names.realm(kingdom.name)} meanwhile.`
                : `👑 ${oldRulerName} of ${Names.realm(kingdom.name)} has died at age ${oldRuler.age}. ${Characters.getDisplayName(heir, kingdom)} ascends to the throne (${successionType}).`;

        world.events.push({
            category: 'political',
            text: eventText,
            kingdom: kingdom.id,
            impact: crisisOccurred ? 'negative' : 'neutral',
        });

        // Remembered for systems/throne.js (succession crises the player can
        // join). Plain bookkeeping — draws no RNG.
        kingdom.lastSuccession = {
            day: world.day,
            type: successionType,
            crisis: crisisOccurred,
            heirName: Characters.getFullName(heir),
            heirAge: heir.age,
            oldRulerName,
            // (the heir reigns elsewhere: the crown abroad, for systems/realmUnions.js to settle)
            ...(abroad ? { abroad: { heirId: abroad.char.id, heirName: Characters.getDisplayName(abroad.char, abroad.home), seatId: abroad.home.id } } : {}),
        };

        return { heir, successionType, crisisOccurred };
    },

    /**
     * Trigger a succession crisis
     */
    _triggerSuccessionCrisis(kingdom, heir, world) {
        // Crisis effects
        const effects = Utils.randPick([
            'civil_war',
            'pretender',
            'nobles_revolt',
            'regency_council',
        ]);

        switch (effects) {
            case 'civil_war':
                // Lose territory and military
                kingdom.military = Math.floor(kingdom.military * 0.6);
                // (the war is paid for: a share of the chests, reckoned on a few weeks' revenue, spent in the capital)
                CrownBooks.spendFromChests(world, kingdom, CrownBooks.lossBasis(kingdom) * 0.3);
                // Reduce stability through advisor loyalty
                if (kingdom.characterData.advisors) {
                    for (const advisor of Object.values(kingdom.characterData.advisors)) {
                        if (advisor) advisor.loyalty = Math.max(0, advisor.loyalty - 30);
                    }
                }
                break;

            case 'pretender':
                // A pretender claims the throne — weaken the kingdom
                kingdom.military = Math.floor(kingdom.military * 0.8);
                // Relations drop with neighbors
                for (const k of Object.keys(kingdom.relations)) {
                    kingdom.relations[k] = Math.max(-100, (kingdom.relations[k] || 0) - 20);
                }
                break;

            case 'nobles_revolt':
                // Nobles rebel — lose some territory
                const tilesToLose = Math.min(Math.floor(kingdom.territory.length * 0.1), 5);
                for (let i = 0; i < tilesToLose; i++) {
                    if (kingdom.territory.length > 3) {
                        const lostTile = kingdom.territory.pop();
                        const tile = world.getTile(lostTile.q, lostTile.r);
                        if (tile) {
                            tile.kingdom = null;
                        }
                    }
                }
                break;

            case 'regency_council':
                // Mild crisis — temporary debuffs
                heir.skills.martial = Math.max(1, heir.skills.martial - 3);
                heir.skills.diplomacy = Math.max(1, heir.skills.diplomacy - 3);
                break;
        }

        return true;
    },

    // ────────────────────────────────────────────────────────────────────
    //  Marriage & Diplomacy
    // ────────────────────────────────────────────────────────────────────
    /**
     * Attempt a diplomatic marriage between two kingdoms
     */
    arrangeMarriage(kingdom1, kingdom2, world) {
        const data1 = kingdom1.characterData;
        const data2 = kingdom2.characterData;
        if (!data1 || !data2) return false;

        // Find eligible characters in each kingdom
        const eligible1 = Characters._getEligibleForMarriage(kingdom1);
        const eligible2 = Characters._getEligibleForMarriage(kingdom2);

        if (eligible1.length === 0 || eligible2.length === 0) return false;

        const char1 = Utils.randPick(eligible1);
        // (a man and a woman: the world's rule on who may wed, Characters.canWed)
        const char2 = Utils.randPick(eligible2.filter(c => Characters.canWed(char1, c)));

        if (!char2 || !Characters.canWed(char1, char2)) return false;

        // Perform marriage
        char1.spouseId = char2.id;
        char2.spouseId = char1.id;

        // Improve relations
        const boost = Utils.randInt(15, 35);
        kingdom1.relations[kingdom2.id] = Math.min(100, (kingdom1.relations[kingdom2.id] || 0) + boost);
        kingdom2.relations[kingdom1.id] = Math.min(100, (kingdom2.relations[kingdom1.id] || 0) + boost);

        // Form alliance if relations are now high enough
        if ((kingdom1.relations[kingdom2.id] || 0) > 60 && !kingdom1.allies.includes(kingdom2.id)) {
            kingdom1.allies.push(kingdom2.id);
            kingdom2.allies.push(kingdom1.id);
        }

        world.events.push({
            category: 'diplomatic',
            text: `💒 A royal marriage between ${Characters.getFullName(char1)} of ${kingdom1.name} and ${Characters.getFullName(char2)} of ${kingdom2.name}! Relations strengthened.`,
            kingdom: kingdom1.id,
            impact: 'positive',
        });

        return true;
    },

    /**
     * Get eligible characters for marriage
     */
    _getEligibleForMarriage(kingdom) {
        const eligible = [];
        const data = kingdom.characterData;
        if (!data) return eligible;

        // Check ruler
        if (data.ruler && data.ruler.isAlive && !data.ruler.spouseId && data.ruler.age >= 16) {
            eligible.push(data.ruler);
        }
        // Check children
        if (data.children) {
            for (const child of data.children) {
                if (child.isAlive && !child.spouseId && child.age >= 16) {
                    eligible.push(child);
                }
            }
        }
        return eligible;
    },

    // ────────────────────────────────────────────────────────────────────
    //  Daily Processing
    // ────────────────────────────────────────────────────────────────────
    /**
     * Process character system each day for all kingdoms
     */
    processTurn(world) {
        for (const kingdom of world.kingdoms) {
            if (!kingdom.isAlive || !kingdom.characterData) continue;
            Characters.processKingdomCharacters(kingdom, world);
        }

        // Consider diplomatic marriages between kingdoms (rare)
        if (Utils.random() < 0.02) {
            Characters._considerDiplomaticMarriages(world);
        }
    },

    /**
     * Process character-related events for a single kingdom
     */
    processKingdomCharacters(kingdom, world) {
        const data = kingdom.characterData;
        if (!data) return;

        const ruler = data.ruler;
        if (!ruler || !ruler.isAlive) return;

        // ── Age characters (once per year = every 120 days) ──
        // (not while the player sits the throne — their own life runs it)
        if (world.day % 120 === 0 && !ruler.isPlayer) {
            Characters._ageCharacters(kingdom, world);
        }

        // ── Apply kingdom bonuses from characters ──
        const bonuses = Characters.getKingdomBonuses(kingdom);
        kingdom.characterBonuses = bonuses;

        // The player sits this throne (systems/throne.js): their own life,
        // family and succession run the court, not NPC dynasty rolls
        if (ruler.isPlayer) return;

        // The name shown reads the record (a junior realm in personal union
        // shows its monarch's, systems/realmUnions.js; a crown the player wears
        // is styled by the player's systems)
        const pu = kingdom.personalUnion;
        if (!(pu && pu.role === 'junior') && !(kingdom.crown && (kingdom.crown.playerRuled || kingdom.crown.union))) {
            if (kingdom.ruler !== Characters.getDisplayName(ruler, kingdom)) Characters.syncRulerName(kingdom);
        }

        // ── Random character events (5% chance per day per kingdom) ──
        if (Utils.random() < 0.05) {
            Characters._triggerCharacterEvent(kingdom, world);
        }

        // ── Heir birth chance (every 30 days if married, ruler < 50) ──
        // (a spouse who reigns or lives in another realm too: the couple's
        // children are rolled at one court of the two, Characters._birthsHere)
        const pair = world.day % 30 === 0 && ruler.age < 50 ? Characters._heirPartner(world, kingdom) : null;
        if (pair) {
            // The `heirs` bonus (Fertile: +0.3) adds half its value to the chance
            const fertilityBonus = Math.max(0, (bonuses.heirs || 0) * 0.5);
            if (Utils.random() < 0.08 + fertilityBonus) {
                Characters._birthChild(kingdom, ruler, pair.partner, world, pair.abroad);
            }
        }

        // ── Advisor loyalty drift ──
        if (world.day % 60 === 0 && data.advisors) {
            for (const [roleId, advisor] of Object.entries(data.advisors)) {
                if (!advisor) continue;
                // Loyalty drifts with the court's `loyalty` bonus (just and
                // charismatic rulers inspire it, cruel and tyrannical ones
                // erode it); paranoid rulers drive advisors away
                let loyaltyChange = Utils.randInt(-5, 5) + Math.round((bonuses.loyalty || 0) * 12);
                if (ruler.traits.some(t => t.id === 'paranoid')) loyaltyChange -= 3;
                advisor.loyalty = Utils.clamp(advisor.loyalty + loyaltyChange, 0, 100);

                // Very disloyal advisor may leave or betray
                if (advisor.loyalty < 10 && Utils.random() < 0.3) {
                    world.events.push({
                        category: 'political',
                        text: `🚪 The ${Characters.ADVISOR_ROLES[roleId].name} of ${Names.realm(kingdom.name)}, ${Characters.getFullName(advisor)}, has abandoned their post!`,
                        kingdom: kingdom.id,
                        impact: 'negative',
                    });
                    // Replace advisor
                    const newAdvisor = Characters.generateCharacter({
                        culture: kingdom.culture,
                        age: Utils.randInt(25, 55),
                    });
                    newAdvisor.advisorRole = roleId;
                    newAdvisor.kingdomId = kingdom.id;
                    newAdvisor.loyalty = Utils.randInt(50, 80);
                    const roleDef = Characters.ADVISOR_ROLES[roleId];
                    newAdvisor.skills[roleDef.primarySkill] = Math.min(20, newAdvisor.skills[roleDef.primarySkill] + Utils.randInt(3, 8));
                    data.advisors[roleId] = newAdvisor;
                }
            }
        }
    },

    /**
     * Age all characters in a kingdom and handle natural deaths
     */
    _ageCharacters(kingdom, world) {
        const data = kingdom.characterData;
        const allChars = Characters._getAllKingdomCharacters(kingdom);

        for (const char of allChars) {
            if (!char.isAlive) continue;
            char.age++;

            // Death chance increases sharply after maxLifespan
            if (char.age >= char.maxLifespan) {
                const deathChance = (char.age - char.maxLifespan + 1) * 0.15;
                if (Utils.random() < deathChance) {
                    char.isAlive = false;
                    char.deathDay = world.day;

                    // If this was the ruler, trigger succession
                    if (char === data.ruler) {
                        Characters.handleSuccession(kingdom, world);
                        return; // Succession handles its own events
                    }

                    // Otherwise just announce
                    if (char === data.spouse) {
                        world.events.push({
                            category: 'political',
                            text: `${Characters.getFullName(char)} of ${Names.realm(kingdom.name)}, spouse of the ruler, has died at age ${char.age}.`,
                            kingdom: kingdom.id,
                            impact: 'neutral',
                        });
                        data.spouse = null;
                        if (data.ruler) data.ruler.spouseId = null;
                    }
                }
            }

            // A court physician (`rulerHealth`) keeps the ruler well
            const care = char === data.ruler ? Math.max(0, (kingdom.characterBonuses && kingdom.characterBonuses.rulerHealth) || 0) : 0;

            // Illness
            if (!char.isIll && char.age > 45 && Utils.random() < 0.02 * (1 - Math.min(0.8, care))) {
                char.isIll = true;
                char.health = Math.max(20, char.health - Utils.randInt(20, 50));
            }

            // Recovery from illness
            if (char.isIll && Utils.random() < 0.3 * (1 + care)) {
                char.isIll = false;
                char.health = Math.min(100, char.health + Utils.randInt(10, 30));
            }

            // Ill characters have higher death chance
            if (char.isIll && Utils.random() < 0.05) {
                char.isAlive = false;
                char.deathDay = world.day;

                if (char === data.ruler) {
                    Characters.handleSuccession(kingdom, world);
                    return;
                }
            }
        }
    },

    /**
     * Birth a new child
     */
    _birthChild(kingdom, parent1, parent2, world, otherRealm = null) {
        const data = kingdom.characterData;
        if (!parent1 || !parent2) return null;
        const child = Characters.generateCharacter({
            culture: kingdom.culture,
            age: 0,
            dynasty: data.dynasty.name,
            birthDay: world.day,
        });
        child.kingdomId = kingdom.id;
        child.parentId = parent1.id;
        child.parentId2 = parent2.id;
        child.maxLifespan = Utils.randInt(55, 90);

        // Child inherits some parent skills (reduced)
        for (const skill of Object.keys(child.skills)) {
            const parentAvg = ((parent1.skills[skill] || 5) + (parent2.skills[skill] || 5)) / 2;
            child.skills[skill] = Math.max(1, Math.floor(parentAvg * 0.5 + Utils.randInt(1, 5)));
        }

        parent1.childrenIds.push(child.id);
        // A child of two realms: of the other parent's line too (Characters._lineOf finds them here)
        if (otherRealm) {
            if (!Array.isArray(parent2.childrenIds)) parent2.childrenIds = [];
            if (!parent2.childrenIds.includes(child.id)) parent2.childrenIds.push(child.id);
            child.otherRealmId = otherRealm.id;
        }

        // Add siblings
        if (data.children) {
            for (const sib of data.children) {
                if (sib.isAlive) {
                    child.siblingIds.push(sib.id);
                    sib.siblingIds.push(child.id);
                }
            }
            data.children.push(child);
        } else {
            data.children = [child];
        }

        data.dynasty.members.push(child.id);
        data.dynasty.prestige += 5;
        Characters.pruneFamily(data, world.day);

        world.events.push({
            category: 'dynasty',
            text: otherRealm
                ? `👶 A child, ${Characters.getFullName(child)}, is born to ${Characters.getFullName(parent1)} of ${Names.realm(kingdom.name)} and ${Characters.getFullName(parent2)} of ${Names.realm(otherRealm.name)}: of the blood of both crowns.`
                : `👶 A child, ${Characters.getFullName(child)}, is born in the royal family of ${Names.realm(kingdom.name)}!`,
            kingdom: kingdom.id,
            impact: 'positive',
        });
        return child;
    },

    /**
     * Trigger a random character event
     */
    _triggerCharacterEvent(kingdom, world) {
        const data = kingdom.characterData;
        const ruler = data.ruler;
        if (!ruler) return;
        // (a spouse at court, or one who lives in another realm: Characters._heirPartner)
        const pair = Characters._heirPartner(world, kingdom);
        const mate = pair ? pair.partner : null;

        // Filter applicable events
        const applicable = Characters.CHARACTER_EVENTS.filter(e => {
            if (e.minAge && ruler.age < e.minAge) return false;
            if (e.maxAge && ruler.age > e.maxAge) return false;
            if (e.requires === 'married' && !mate) return false;
            if (e.requires === 'ill' && !ruler.isIll) return false;
            if (e.requires === 'no_heirs' && ruler.childrenIds.length > 0) return false;
            if (e.requires === 'has_children' && (!data.children || data.children.filter(c => c.isAlive).length === 0)) return false;
            if (e.requires === 'unmarried_heir') {
                const unmarriedHeir = data.children && data.children.find(c => c.isAlive && c.age >= 16 && !c.spouseId);
                if (!unmarriedHeir) return false;
            }
            return true;
        });

        if (applicable.length === 0) return;

        // Weighted pick
        const totalWeight = applicable.reduce((s, e) => s + e.weight, 0);
        let roll = Utils.random() * totalWeight;
        let chosen = applicable[0];
        for (const e of applicable) {
            roll -= e.weight;
            if (roll <= 0) { chosen = e; break; }
        }

        // Fill in template text
        let text = chosen.text;
        text = text.replace('{ruler}', Characters.getFullName(ruler));
        text = text.replace('{kingdom}', kingdom.name);
        text = text.replace('{dynasty}', data.dynasty.name);

        if (mate || data.spouse) {
            text = text.replace('{spouse}', Characters.getFullName(mate || data.spouse));
        }

        if (data.children && data.children.length > 0) {
            const livingChild = data.children.find(c => c.isAlive);
            if (livingChild) {
                text = text.replace('{child}', Characters.getFullName(livingChild));
                text = text.replace('{heir}', Characters.getFullName(livingChild));
            }
        }

        if (data.advisors) {
            const roleKeys = Object.keys(data.advisors).filter(k => data.advisors[k]);
            if (roleKeys.length > 0) {
                const randomRole = Utils.randPick(roleKeys);
                text = text.replace('{advisorRole}', Characters.ADVISOR_ROLES[randomRole].name);
            }
        }

        // Resolve {char1}, {char2} for marriage proposals
        text = text.replace('{char1}', Characters.getFullName(ruler));
        const otherKingdoms = world.kingdoms.filter(k => k.isAlive && k.id !== kingdom.id && k.characterData);
        let partner = null;
        if (otherKingdoms.length > 0) {
            const otherK = Utils.randPick(otherKingdoms);
            partner = otherK;
            const otherRuler = otherK.characterData.ruler;
            if (otherRuler) {
                text = text.replace('{char2}', Characters.getFullName(otherRuler));
            }
        }

        // Handle trait gained
        if (chosen.id === 'trait_gained') {
            const traitKeys = Object.keys(Characters.RULER_TRAITS).filter(
                t => !ruler.traits.some(rt => rt.id === t)
            );
            if (traitKeys.length > 0) {
                const newTraitId = Utils.randPick(traitKeys);
                const newTrait = Characters.RULER_TRAITS[newTraitId];
                ruler.traits.push(newTrait);
                text = text.replace('{trait}', newTrait.name);
            }
        }

        // Handle specific event effects
        Characters._applyEventEffects(chosen, kingdom, world);
        // Data-driven effects (characters.json characterEvents[].effects)
        Characters.applyEventDataEffects(chosen.effects, kingdom, world, partner);

        world.events.push({
            category: chosen.type || 'political',
            text: text,
            kingdom: kingdom.id,
            impact: chosen.impact || 'neutral',
        });
    },

    /**
     * Apply an event's data-driven `effects` (characters.json) to its kingdom:
     *   stability     ± points of kingdom stability (drifts back over weeks)
     *   treasuryPct   ± fraction of the treasury (trade booms, droughts)
     *   populationPct ± fraction of every settlement's population (plague, harvest)
     *   militaryPct   ± fraction of the kingdom's military strength
     *   damage        storm/flood damage added to each settlement (cuts
     *                 gold and goods until builders repair it)
     *   relationsAll / relationsRival / relationsPartner
     *                 ± relations with every realm / one random realm /
     *                 the realm named in the event text
     * Returns a summary of what changed (for tests and tooltips).
     */
    applyEventDataEffects(effects, kingdom, world, partner = null) {
        const out = {};
        if (!effects || !kingdom) return out;
        const fx = effects;
        if (fx.stability) {
            const before = typeof kingdom.stability === 'number' && !Number.isNaN(kingdom.stability) ? kingdom.stability : 60;
            kingdom.stability = Utils.clamp(before + fx.stability, 0, 100);
            out.stability = kingdom.stability - before;
        }
        if (fx.treasuryPct && typeof kingdom.treasury === 'number') {
            // (real coin both ways, reckoned on a few weeks' revenue at most — CrownBooks.lossBasis: a loss
            // is spent in the capital, a windfall comes out of the realm's towns' purses, 5% each at most)
            const amount = Math.round(CrownBooks.lossBasis(kingdom) * Math.abs(fx.treasuryPct));
            let delta = 0;
            if (fx.treasuryPct < 0) delta = -CrownBooks.spendFromChests(world, kingdom, amount);
            else if (amount > 0 && world && typeof world.getTile === 'function') {
                const towns = Economy.realmTowns(kingdom, world).filter(t => Economy.townPurse(t.settlement) != null)
                    .map(t => ({ settlement: t.settlement, weight: Math.max(1, t.settlement.population || 0) }));
                delta = Math.floor(Economy.drawTowns(towns, amount, 0.05).paid * 100) / 100;
                kingdom.treasury += delta;
            }
            out.treasury = delta;
        }
        if (fx.militaryPct && typeof kingdom.military === 'number') {
            const before = kingdom.military;
            kingdom.military = Math.max(0, Math.round(before * (1 + fx.militaryPct)));
            out.military = kingdom.military - before;
        }
        if ((fx.populationPct || fx.damage) && world && typeof world.getTile === 'function') {
            let popDelta = 0;
            for (const t of kingdom.territory || []) {
                const tile = world.getTile(t.q, t.r);
                const st = tile && tile.settlement;
                if (!st || st.kingdom !== kingdom.id) continue;
                if (fx.populationPct && st.population > 0) {
                    const next = Math.max(10, Math.round(st.population * (1 + fx.populationPct)));
                    popDelta += next - st.population;
                    st.population = next;
                }
                if (fx.damage) st.damage = Math.min(0.9, Math.round(((st.damage || 0) + fx.damage) * 1000) / 1000);
            }
            if (fx.populationPct) out.population = popDelta;
        }
        const shift = (otherId, delta) => {
            if (!kingdom.relations) kingdom.relations = {};
            kingdom.relations[otherId] = Utils.clamp((kingdom.relations[otherId] || 0) + delta, -100, 100);
            const other = world && world.kingdoms ? world.kingdoms.find(k => k.id === otherId) : null;
            if (other) {
                if (!other.relations) other.relations = {};
                other.relations[kingdom.id] = Utils.clamp((other.relations[kingdom.id] || 0) + delta, -100, 100);
            }
        };
        if (fx.relationsAll) {
            for (const k of Object.keys(kingdom.relations || {})) shift(k, fx.relationsAll);
        }
        if (fx.relationsRival && world && world.kingdoms) {
            const others = world.kingdoms.filter(k => k.isAlive && k.id !== kingdom.id);
            if (others.length) {
                const rival = Utils.randPick(others);
                shift(rival.id, fx.relationsRival);
                out.rival = rival.id;
            }
        }
        if (fx.relationsPartner && partner) {
            shift(partner.id, fx.relationsPartner);
            out.partner = partner.id;
        }
        return out;
    },

    /**
     * Apply mechanical effects of character events
     */
    _applyEventEffects(event, kingdom, world) {
        switch (event.id) {
            case 'ruler_ill':
                if (kingdom.characterData.ruler) {
                    kingdom.characterData.ruler.isIll = true;
                    kingdom.characterData.ruler.health -= Utils.randInt(20, 40);
                }
                break;

            case 'ruler_recovers':
                if (kingdom.characterData.ruler) {
                    kingdom.characterData.ruler.isIll = false;
                    kingdom.characterData.ruler.health = Math.min(100, kingdom.characterData.ruler.health + 30);
                }
                break;

            case 'assassination_attempt': {
                const ruler = kingdom.characterData.ruler;
                const spymaster = kingdom.characterData.advisors?.spymaster;
                // Spymaster skill determines survival chance
                const survivalChance = spymaster ? 0.5 + (spymaster.skills.intrigue / 40) : 0.4;
                if (Utils.random() > survivalChance) {
                    // Ruler dies from assassination
                    world.events.push({
                        category: 'political',
                        text: `💀 The assassination of ${Characters.getFullName(ruler)} in ${Names.realm(kingdom.name)} succeeds! The realm is thrown into chaos.`,
                        kingdom: kingdom.id,
                        impact: 'negative',
                    });
                    Characters.handleSuccession(kingdom, world);
                } else {
                    ruler.health -= Utils.randInt(10, 30);
                }
                break;
            }

            case 'advisor_scandal': {
                const advisors = kingdom.characterData.advisors;
                if (advisors) {
                    const roleKeys = Object.keys(advisors).filter(k => advisors[k]);
                    if (roleKeys.length > 0) {
                        const role = Utils.randPick(roleKeys);
                        advisors[role].loyalty -= 20;
                        CrownBooks.spendFromChests(world, kingdom, CrownBooks.lossBasis(kingdom) * 0.1);
                    }
                }
                break;
            }

            case 'advisor_betrayal': {
                const advisors = kingdom.characterData.advisors;
                if (advisors) {
                    const roleKeys = Object.keys(advisors).filter(k => advisors[k]);
                    if (roleKeys.length > 0) {
                        const role = Utils.randPick(roleKeys);
                        // Replace the traitor
                        const newAdvisor = Characters.generateCharacter({
                            culture: kingdom.culture,
                            age: Utils.randInt(25, 55),
                        });
                        newAdvisor.advisorRole = role;
                        newAdvisor.kingdomId = kingdom.id;
                        newAdvisor.loyalty = Utils.randInt(50, 80);
                        advisors[role] = newAdvisor;
                    }
                }
                // Relations drop with all neighbors
                for (const k of Object.keys(kingdom.relations)) {
                    kingdom.relations[k] = Math.max(-100, (kingdom.relations[k] || 0) - 10);
                }
                break;
            }

            case 'feast':
                // Improve relations slightly with all kingdoms
                for (const k of Object.keys(kingdom.relations)) {
                    kingdom.relations[k] = Math.min(100, (kingdom.relations[k] || 0) + 5);
                }
                CrownBooks.spendFromChests(world, kingdom, Utils.randInt(50, 200));
                break;

            case 'tournament':
                kingdom.military = Math.floor(kingdom.military * 1.05);
                CrownBooks.spendFromChests(world, kingdom, Utils.randInt(100, 300));
                break;

            case 'heir_born': {
                // (the consort at court, or a spouse abroad: Characters._heirPartner)
                const pair = Characters._heirPartner(world, kingdom);
                Characters._birthChild(
                    kingdom,
                    kingdom.characterData.ruler,
                    pair ? pair.partner : kingdom.characterData.spouse,
                    world,
                    pair ? pair.abroad : null
                );
                break;
            }

            case 'succession_crisis':
                Characters._triggerSuccessionCrisis(kingdom, kingdom.characterData.ruler, world);
                break;
        }
    },

    /**
     * Consider arranging marriages between kingdoms for diplomacy
     */
    _considerDiplomaticMarriages(world) {
        const aliveKingdoms = world.kingdoms.filter(k => k.isAlive && k.characterData);
        if (aliveKingdoms.length < 2) return;

        const k1 = Utils.randPick(aliveKingdoms);
        const potentialPartners = aliveKingdoms.filter(k =>
            k.id !== k1.id &&
            !k1.wars.includes(k.id) &&
            (k1.relations[k.id] || 0) > -20
        );

        if (potentialPartners.length === 0) return;
        const k2 = Utils.randPick(potentialPartners);

        Characters.arrangeMarriage(k1, k2, world);
    },
});
