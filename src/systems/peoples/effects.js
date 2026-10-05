// Peoples — effects members: what a settlement's peoples actually DO.
//
// Every people (data/peoples.json → tribalRoots) carries values, traits, art
// forms, customs, cuisine, a homeland and lore. Those used to be shown and
// never read. Here they become small, data-driven modifiers:
//
//   values / traits / artForms / diaspora status  → aspect scores
//       (data/peoples.json → effects.valueAspects, traitAspects, artKeywords,
//        statusAspects), weighted by each group's share of the settlement
//   signatureArt, thriving/restless quarters      → aspect scores
//   cuisine (distinct peoples + hybrid dishes)    → food ("varied larder")
//   culturalHarmony + hybridTraditions            → stability points
//   homeland                                      → slow sentiment gain at home
//   EVOLUTION_STAGES                              → cultural interaction rate
//   customs / signatureFestival                   → festivals held here
//   signatureDish / hybrid dishes                 → tavern meals
//   origin / ancestralMemory / proverb (lore)     → heritage trade bonus
//
// The result is cached as plain data on settlement.peoplesEffects (and a
// population-weighted kingdom.peoples) so world/ and player/ code can read it
// without importing systems/. Nothing here draws randomness.

import { Peoples } from './_ref.js';
import { Utils, Hex } from './_imports.js';

/** Aspect ids in display order (from data). */
function aspectIds() {
    const E = Peoples.EFFECTS;
    return E && E.aspects ? Object.keys(E.aspects) : [];
}

/** 'goods' | ['stability', -1] → ['goods', 1] / ['stability', -1]. */
function specOf(spec) {
    if (!spec) return null;
    if (Array.isArray(spec)) return [spec[0], typeof spec[1] === 'number' ? spec[1] : 1];
    return [spec, 1];
}

const artAspectMemo = { tables: null, map: null };

/**
 * The aspects a people's values, traits and art forms feed, in their order —
 * a people's culture doesn't change, so this is worked out once per tribe
 * object (and effect tables). Values: [aspect, strength, value]; traits:
 * [aspect, multiplier, trait]; arts: [aspect, art].
 */
const tribeAspectMemo = new WeakMap();

function tribeAspects(tribe, E) {
    const hit = tribeAspectMemo.get(tribe);
    if (hit && hit.tables === E) return hit;
    const out = { tables: E, values: [], traits: [], arts: [] };
    for (const [value, strength] of Object.entries(tribe.values || {})) out.values.push([E.valueAspects[value], strength, value]);
    for (const trait of tribe.traits || []) {
        const spec = specOf(E.traitAspects[trait]);
        if (spec) out.traits.push([spec[0], spec[1], trait]);
    }
    for (const art of tribe.artForms || []) out.arts.push([Peoples.artAspect(art), art]);
    if (typeof tribe === 'object') tribeAspectMemo.set(tribe, out);
    return out;
}

/** How computeEffects words a source of an aspect (the "why" list). */
const LABEL = { spaced: 0, trait: 1, status: 2, knownFor: 3, quarter: 4, restless: 5, larder: 6 };

function sourceLabel(s) {
    switch (s.kind) {
        case LABEL.spaced: return `${s.a} ${s.b}`;
        case LABEL.trait: return `${s.a}: ${s.b}`;
        case LABEL.status: return `${s.a} ${s.b}s`;
        case LABEL.knownFor: return `known for ${s.a}`;
        case LABEL.quarter: return `${s.a} (${s.b})`;
        case LABEL.restless: return `${s.a} is restless`;
        default: return `varied larder (${s.a} cuisines)`;
    }
}

function round(v, places = 3) {
    const f = Math.pow(10, places);
    return Math.round(v * f) / f;
}

Object.assign(Peoples, {
    /** Effect tables — replaced by data/peoples.json "effects" via DataLoader. */
    EFFECTS: Peoples.EFFECTS || null,

    /** Aspect an art form feeds (keyword = prefix of a word in its name), or null. */
    artAspect(art) {
        const E = Peoples.EFFECTS;
        if (!E || !art) return null;
        // Pure in (art, effect tables): memoised per tables object, since
        // every settlement's effects are recomputed every day
        if (artAspectMemo.tables !== E) { artAspectMemo.tables = E; artAspectMemo.map = new Map(); }
        const key = String(art);
        if (artAspectMemo.map.has(key)) return artAspectMemo.map.get(key);
        const aspect = Peoples._artAspect(E, key);
        artAspectMemo.map.set(key, aspect);
        return aspect;
    },

    _artAspect(E, art) {
        const tokens = String(art).toLowerCase().split(/[^a-z]+/).filter(Boolean);
        for (const [aspect, words] of E.artKeywords || []) {
            if (words.some(w => tokens.some(tok => tok.startsWith(w.trim())))) return aspect;
        }
        return null;
    },

    /** Evolution stage (data EVOLUTION_STAGES) a population falls in, with its index. */
    getEvolutionStage(population) {
        const stages = Peoples.EVOLUTION_STAGES || [];
        if (stages.length === 0) return { stage: null, index: 0 };
        const pop = Math.max(0, population || 0);
        let index = 0;
        for (let i = 0; i < stages.length; i++) {
            if (pop >= stages[i].population[0]) index = i;
        }
        return { stage: stages[index], index };
    },

    /**
     * Daily chance of a cultural interaction: bigger, more mixed places
     * (later evolution stages) meet and mingle more often.
     */
    interactionChance(settlement) {
        const ev = (Peoples.EFFECTS && Peoples.EFFECTS.evolution) || { interactionBase: 1, interactionPerStage: 0 };
        const { index } = Peoples.getEvolutionStage(settlement.population);
        return 0.005 * (ev.interactionBase + ev.interactionPerStage * index);
    },

    /** Harmony added by the settlement's hybrid traditions. */
    hybridHarmonyBonus(settlement) {
        const h = Peoples.EFFECTS && Peoples.EFFECTS.harmony;
        const n = (settlement.hybridTraditions || []).length;
        if (!h || n === 0) return 0;
        return Math.min(h.hybridMax, n * h.hybridBonus);
    },

    /** Terrain ids that count as a tribe's homeland. */
    homelandTerrains(tribe) {
        const map = Peoples.EFFECTS && Peoples.EFFECTS.homelandTerrain;
        return (map && tribe && map[tribe.homeland]) || [];
    },

    /** Is the settlement on (or beside) this people's homeland terrain? */
    isAtHome(tribe, q, r, world) {
        const terrains = Peoples.homelandTerrains(tribe);
        if (terrains.length === 0 || !world || !world.getTile) return false;
        const hexes = [{ q, r }, ...Hex.neighbors(q, r)];
        return hexes.some(h => {
            const t = world.getTile(h.q, h.r);
            return !!(t && t.terrain && terrains.includes(t.terrain.id));
        });
    },

    /**
     * Groups living on their homeland grow content: +1 sentiment every
     * `everyDays` days, up to the cap. Terrain doesn't change, so the
     * at-home flag is cached on the group.
     */
    applyHomeland(settlement, q, r, world) {
        const hl = Peoples.EFFECTS && Peoples.EFFECTS.homeland;
        if (!hl || !settlement.demographics) return;
        for (const demo of settlement.demographics) {
            if (typeof demo.atHome !== 'boolean') demo.atHome = Peoples.isAtHome(demo.tribe, q, r, world);
        }
        const day = world && typeof world.day === 'number' ? world.day : 0;
        if (day <= 0 || day % hl.everyDays !== 0) return;
        for (const demo of settlement.demographics) {
            if (demo.atHome && demo.sentiment < hl.sentimentCap) {
                demo.sentiment = Math.min(hl.sentimentCap, demo.sentiment + hl.sentimentGain);
            }
        }
    },

    /** Quarter mood follows its people's current sentiment. */
    refreshQuarterMoods(settlement) {
        if (!settlement.culturalQuarters || !settlement.demographics) return;
        for (const q of settlement.culturalQuarters) {
            const demo = settlement.demographics.find(d => d.tribe && d.tribe.id === q.tribe);
            if (!demo) continue;
            q.mood = demo.sentiment > 70 ? 'thriving' : demo.sentiment > 40 ? 'content' : 'restless';
        }
    },

    /**
     * Pure: the modifiers this settlement's peoples produce.
     * Percent aspects are fractions (0.04 = +4%); stability is in points.
     */
    computeEffects(settlement) {
        const E = Peoples.EFFECTS;
        const out = { why: {} };
        for (const id of aspectIds()) out[id] = 0;
        out.stabilityFromHarmony = 0;
        if (!E || !settlement || !Array.isArray(settlement.demographics) || settlement.demographics.length === 0) return out;

        const W = E.weights;
        const scores = {};
        const sources = {};
        // Labels are only spelled out for the top three sources of each
        // aspect (see sourceLabel): kind + up to two parts
        const add = (aspect, amount, kind, a, b) => {
            if (!aspect || !E.aspects[aspect] || !amount) return;
            scores[aspect] = (scores[aspect] || 0) + amount;
            (sources[aspect] = sources[aspect] || []).push({ amount, kind, a, b });
        };

        for (const demo of settlement.demographics) {
            const tribe = demo.tribe;
            if (!tribe) continue;
            const share = Math.max(0, demo.share || 0);
            const parts = tribeAspects(tribe, E);
            for (const [aspect, strength, value] of parts.values) {
                add(aspect, share * strength * W.valuePerPoint, LABEL.spaced, tribe.name, value);
            }
            for (const [aspect, mult, trait] of parts.traits) {
                add(aspect, share * W.trait * mult, LABEL.trait, tribe.name, trait);
            }
            for (const [aspect, art] of parts.arts) {
                add(aspect, share * W.artForm, LABEL.spaced, tribe.name, art);
            }
            const st = specOf(E.statusAspects[demo.status]);
            if (st) add(st[0], share * W.status * st[1], LABEL.status, tribe.name, demo.status);
        }

        const identity = settlement.culturalIdentity;
        if (identity && identity.signatureArt) {
            add(Peoples.artAspect(identity.signatureArt), W.signatureArt, LABEL.knownFor, identity.signatureArt);
        }

        for (const q of settlement.culturalQuarters || []) {
            if (q.mood === 'thriving') add(Peoples.artAspect(q.specialty), W.thrivingQuarter, LABEL.quarter, q.name, q.specialty);
            else if (q.mood === 'restless') add('stability', W.restlessQuarter, LABEL.restless, q.name);
        }

        // Cuisine: every distinct people's kitchen (and each hybrid dish) widens the larder
        const kitchens = new Set(settlement.demographics.map(d => d.tribe && d.tribe.id).filter(Boolean)).size
            + (settlement.hybridTraditions || []).filter(t => t.cuisine).length;
        if (kitchens > 1) {
            add('food', Math.min(W.cuisineMax, (kitchens - 1) * W.cuisinePerPeople), LABEL.larder, kitchens);
        }

        for (const [aspect, def] of Object.entries(E.aspects)) {
            const raw = (scores[aspect] || 0) * def.scale;
            out[aspect] = round(Utils.clamp(raw, -def.max, def.max), def.pct ? 3 : 1);
            if (sources[aspect]) {
                out.why[aspect] = sources[aspect]
                    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
                    .slice(0, 3)
                    .map(sourceLabel);
            }
        }

        // Harmony (and the hybrid traditions folded into it) steadies the place
        const h = E.harmony;
        if (h && typeof settlement.culturalHarmony === 'number') {
            out.stabilityFromHarmony = round((settlement.culturalHarmony - 50) * h.stabilityPerPoint, 1);
            out.stability = round(Utils.clamp(out.stability + out.stabilityFromHarmony, -h.stabilityTotalMax, h.stabilityTotalMax), 1);
        }
        return out;
    },

    /** Recompute and cache settlement.peoplesEffects. */
    refreshEffects(settlement) {
        if (!settlement || !settlement.demographics) return null;
        Peoples.refreshQuarterMoods(settlement);
        settlement.peoplesEffects = Peoples.computeEffects(settlement);
        return settlement.peoplesEffects;
    },

    /** Refresh every settlement's effects and the kingdom totals (world generation / load). */
    refreshAllEffects(world) {
        const totals = {};
        for (const s of world.getAllSettlements()) {
            const tile = world.getTile(s.q, s.r);
            if (!tile || !tile.settlement || !tile.settlement.demographics) continue;
            Peoples.refreshEffects(tile.settlement);
            Peoples.accumulateKingdom(totals, tile.settlement);
        }
        Peoples.applyKingdomTotals(world, totals);
    },

    /** Add one settlement's effects (population-weighted) to the per-kingdom totals. */
    accumulateKingdom(totals, settlement) {
        const pe = settlement.peoplesEffects;
        if (!pe || !settlement.kingdom) return;
        const w = Math.max(1, settlement.population || 0);
        const t = totals[settlement.kingdom] || (totals[settlement.kingdom] = { weight: 0, harmony: 0, sums: {} });
        t.weight += w;
        t.harmony += (settlement.culturalHarmony || 0) * w;
        for (const id of aspectIds()) t.sums[id] = (t.sums[id] || 0) + (pe[id] || 0) * w;
    },

    /**
     * kingdom.peoples = { bonuses: {military, faith, ...}, stability, harmony, aspects }
     * KingdomBonuses.get() adds the bonuses; KingdomStability adds the stability points.
     */
    applyKingdomTotals(world, totals) {
        const map = (Peoples.EFFECTS && Peoples.EFFECTS.kingdomBonuses) || {};
        for (const kingdom of world.kingdoms || []) {
            const t = totals[kingdom.id];
            if (!t || t.weight <= 0) { kingdom.peoples = null; continue; }
            const aspects = {};
            for (const [id, sum] of Object.entries(t.sums)) aspects[id] = round(sum / t.weight, 3);
            const bonuses = {};
            for (const [aspect, [key, mult]] of Object.entries(map)) {
                const v = round((aspects[aspect] || 0) * mult, 3);
                if (v) bonuses[key] = (bonuses[key] || 0) + v;
            }
            kingdom.peoples = {
                bonuses,
                stability: round(aspects.stability || 0, 1),
                harmony: Math.round(t.harmony / t.weight),
                aspects,
            };
        }
    },

    // ─────────────────────────────────────────────
    // PLAYER-FACING HOOKS
    // ─────────────────────────────────────────────

    /** Recruitment here: martial peoples supply more recruits and cheaper ones. */
    recruitModifiers(settlement) {
        const pe = settlement && settlement.peoplesEffects;
        const martial = (pe && pe.martial) || 0;
        const share = (Peoples.EFFECTS && Peoples.EFFECTS.recruit && Peoples.EFFECTS.recruit.costShare) || 0.5;
        return { martial, capacityMult: 1 + martial, costMult: 1 - martial * share };
    },

    /**
     * Festival held in this settlement: the local peoples' customs are honoured.
     * Raises every group's sentiment; a signature festival and festive peoples
     * add renown. Returns what happened for the result screen.
     */
    celebrateFestival(settlement) {
        const F = Peoples.EFFECTS && Peoples.EFFECTS.festival;
        const out = { custom: null, renownBonus: 0, sentimentGain: 0, festive: 0 };
        if (!F || !settlement || !settlement.demographics) return out;
        const identity = settlement.culturalIdentity;
        if (identity && identity.signatureFestival) {
            out.custom = identity.signatureFestival;
            out.renownBonus += F.signatureRenown;
        }
        const festive = (settlement.peoplesEffects && settlement.peoplesEffects.festive) || 0;
        out.festive = festive;
        if (festive >= F.festiveThreshold) out.renownBonus += F.festiveRenown;
        for (const demo of settlement.demographics) {
            demo.sentiment = Utils.clamp((demo.sentiment || 0) + F.sentimentGain, 0, 100);
        }
        out.sentimentGain = F.sentimentGain;
        settlement.culturalHarmony = Utils.clamp(
            Peoples.calculateHarmony(settlement.demographics) + Peoples.hybridHarmonyBonus(settlement), 0, 100);
        Peoples.refreshEffects(settlement);
        return out;
    },

    /** A tavern meal here: the local signature dish (and hybrid dishes) comfort more. */
    mealBonus(settlement) {
        const T = Peoples.EFFECTS && Peoples.EFFECTS.tavern;
        const out = { dish: null, hybridDish: null, comfort: 0 };
        if (!T || !settlement) return out;
        const dish = settlement.culturalIdentity && settlement.culturalIdentity.signatureDish;
        if (dish) { out.dish = dish; out.comfort += T.signatureComfort; }
        const hybrids = (settlement.hybridTraditions || []).filter(t => t.cuisine);
        if (hybrids.length > 0) {
            out.hybridDish = hybrids[hybrids.length - 1].cuisine;
            out.comfort += Math.min(T.hybridMax, hybrids.length * T.hybridComfort);
        }
        return out;
    },

    /**
     * Record which peoples' origin lore (the tribal_origin entry that tells
     * their origin and ancestral memory) the player has discovered.
     */
    syncHeritage(player, world, history = null) {
        if (!player) return {};
        if (!player.peoplesHeritage || typeof player.peoplesHeritage !== 'object') player.peoplesHeritage = {};
        const known = player.discoveredLore;
        if (!known || typeof known.has !== 'function' || known.size === 0 || !world) return player.peoplesHeritage;
        for (const entry of history || Peoples.getMergedHistory(world)) {
            if (entry.type === 'tribal_origin' && entry.tribe && known.has(entry.id)) {
                player.peoplesHeritage[entry.tribe] = true;
            }
        }
        return player.peoplesHeritage;
    },

    /**
     * Knowing a people's story earns their trust at market: share of the
     * settlement whose heritage you know × tradePerShare (capped).
     * Returns { bonus, peoples: [{name, proverb}] }.
     */
    heritageTradeBonus(player, settlement) {
        const H = Peoples.EFFECTS && Peoples.EFFECTS.heritage;
        const out = { bonus: 0, peoples: [] };
        const known = player && player.peoplesHeritage;
        if (!H || !known || !settlement || !settlement.demographics) return out;
        let share = 0;
        for (const demo of settlement.demographics) {
            if (demo.tribe && known[demo.tribe.id]) {
                share += demo.share || 0;
                if (!out.peoples.some(p => p.name === demo.tribe.name)) out.peoples.push({ name: demo.tribe.name, proverb: demo.tribe.proverb });
            }
        }
        out.bonus = round(Math.min(H.max, share * H.tradePerShare), 3);
        return out;
    },

    /** Everything the peoples add to the player's buy/sell prices here. */
    playerTradeBonus(player, settlement) {
        if (!settlement) return 0;
        const pe = settlement.peoplesEffects;
        const share = (Peoples.EFFECTS && Peoples.EFFECTS.playerTradeShare) || 0;
        return round(((pe && pe.trade) || 0) * share + Peoples.heritageTradeBonus(player, settlement).bonus, 3);
    },

    /**
     * Display lines for the settlement panel: [{ icon, label, text, why }]
     * — one per non-zero effect, worded with the actual numbers.
     */
    describeEffects(settlement, player = null) {
        const E = Peoples.EFFECTS;
        const pe = settlement && settlement.peoplesEffects;
        const lines = [];
        if (!E || !pe) return lines;
        for (const [id, def] of Object.entries(E.aspects)) {
            const v = pe[id] || 0;
            if (def.pct ? Math.abs(v) < 0.005 : Math.abs(v) < 0.5) continue;
            const amount = def.pct ? `${v > 0 ? '+' : ''}${Math.round(v * 100)}%` : `${v > 0 ? '+' : ''}${v}`;
            let why = (pe.why && pe.why[id]) || [];
            if (id === 'stability' && pe.stabilityFromHarmony) why = [`harmony ${pe.stabilityFromHarmony > 0 ? '+' : ''}${pe.stabilityFromHarmony}`, ...why];
            lines.push({ icon: def.icon, label: def.label, text: `${amount} ${def.describe}`, why: why.join(', ') });
        }
        if (player) {
            const h = Peoples.heritageTradeBonus(player, settlement);
            if (h.bonus > 0) {
                lines.push({
                    icon: '📜', label: 'Heritage',
                    text: `+${Math.round(h.bonus * 100)}% your market prices — you know the story of the ${h.peoples.map(p => p.name).join(' and ')}`,
                    why: h.peoples.map(p => `${p.name}: ${p.proverb}`).join(' '),
                });
            }
        }
        const meal = Peoples.mealBonus(settlement);
        if (meal.comfort > 0) {
            lines.push({ icon: '🍲', label: 'Cuisine', text: `tavern meals +${meal.comfort} comfort (${meal.dish || meal.hybridDish})`, why: '' });
        }
        if (settlement.culturalIdentity && settlement.culturalIdentity.signatureFestival) {
            const F = E.festival;
            lines.push({
                icon: '🎊', label: 'Customs',
                text: `a festival here honours the ${settlement.culturalIdentity.signatureFestival}: +${F.signatureRenown} renown, +${F.sentimentGain} mood for every people`,
                why: '',
            });
        }
        return lines;
    },

    /** Short label for a group's homeland status, e.g. 'at home in the forest'. */
    homelandLabel(demo) {
        if (!demo || !demo.tribe) return '';
        return demo.atHome ? `at home (${String(demo.tribe.homeland).replace(/_/g, ' ')})` : '';
    },
});
