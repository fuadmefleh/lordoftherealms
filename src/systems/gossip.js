// ============================================
// GOSSIP SYSTEM — Rumors, Witnesses & Consequences
//
// Tracks crimes (murder, assault, theft) committed by the player.
// NPCs within witness radius generate rumors that spread between
// settlements over time. If rumors become credible enough,
// consequences follow: reputation loss, bounties, hostile guards.
//
// Rumor lifecycle:
//   1. Crime committed → witnesses detected → rumor created
//   2. Rumor spreads daily to nearby/connected settlements
//   3. Consequences applied when rumor credibility + severity
//      exceed thresholds at a settlement
//   4. Rumors decay over time and eventually expire
//
// Rumours grow in the telling: each town a rumour reaches either hears the
// version the last town told or a changed one (data/gossip.json → tellings):
// grown, monstrous, softened, pinned on a stranger, a deed credited to a
// rival. The telling scales the rumour's severity in that town, so the same
// murder can earn a bounty in one place and a shrug in the next. A bard can
// sing a crime rumour down in a town (refute), and that telling spreads too.
// ============================================

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';

export const Gossip = {

    // ── Runtime state (persisted on player.gossip) ──
    // Access via player.gossip — initialized in initializePlayer()

    // ══════════════════════════════════════════════
    // DATA ACCESS
    // ══════════════════════════════════════════════

    _getData() {
        if (typeof DataLoader !== 'undefined' && DataLoader.gossip) {
            return DataLoader.gossip;
        }
        return null;
    },

    _getRumorType(typeId) {
        const data = this._getData();
        return data && data.rumorTypes ? data.rumorTypes[typeId] : null;
    },

    // ══════════════════════════════════════════════
    // INITIALIZATION
    // ══════════════════════════════════════════════

    /**
     * Initialize gossip state on a player object.
     * Called at game start and on load if missing.
     */
    initializePlayer(player) {
        if (!player.gossip) {
            player.gossip = {
                rumors: [],           // Active rumors: [{ id, type, perpetrator, victim, ... }]
                nextRumorId: 1,
                bounties: [],         // Active bounties: [{ rumorId, kingdom, gold, issued }]
                knownRumors: [],      // Rumor IDs the player has heard about (via tavern)
                totalKills: 0,
                witnessedKills: 0,
                unwitnessedKills: 0,
            };
        }
    },

    /**
     * Restore gossip state after a save is loaded.
     */
    loadState(player) {
        this.initializePlayer(player);
        // Ensure all rumors have required fields after version upgrades
        for (const rumor of player.gossip.rumors) {
            if (!rumor.spreadTo) rumor.spreadTo = [];
            if (rumor.credibility == null) rumor.credibility = 0.5;
        }
    },

    // ══════════════════════════════════════════════
    // CRIME REPORTING — called from combat system
    // ══════════════════════════════════════════════

    /**
     * Report a crime committed by the player (NPC killed or attacked).
     * Detects witnesses, creates a rumor, and applies immediate effects.
     *
     * @param {Object} player - Player state
     * @param {Object} world  - World state
     * @param {Object} opts
     * @param {string} opts.crimeType   - 'murder' | 'assault' | 'theft'
     * @param {Object} opts.victim      - { name, type, icon } of the target NPC
     * @param {number} opts.q           - World tile Q of the crime location
     * @param {number} opts.r           - World tile R of the crime location
     * @param {string} [opts.location]  - Settlement name (auto-detected if omitted)
     * @param {string} [opts.kingdom]   - Kingdom ID (auto-detected if omitted)
     * @returns {{ witnessed: boolean, witnessCount: number, rumor: Object|null, witnesses: Object[] }}
     */
    reportCrime(player, world, opts) {
        this.initializePlayer(player);
        const data = this._getData();
        if (!data) return { witnessed: false, witnessCount: 0, rumor: null, witnesses: [] };

        const { crimeType, victim, q, r } = opts;

        // Determine the specific rumor type based on victim type
        let rumorTypeId = crimeType;
        if (crimeType === 'murder' && data.npcTypeWeights && data.npcTypeWeights[victim.type]) {
            rumorTypeId = data.npcTypeWeights[victim.type];
        }

        const rumorTypeDef = data.rumorTypes[rumorTypeId] || data.rumorTypes[crimeType];
        if (!rumorTypeDef) return { witnessed: false, witnessCount: 0, rumor: null, witnesses: [] };

        // Auto-detect location info
        let locationName = opts.location || 'the wilderness';
        let kingdomId = opts.kingdom || null;
        if (world && q != null && r != null) {
            const tile = world.getTile ? world.getTile(q, r) : null;
            if (tile && tile.settlement) {
                locationName = tile.settlement.name || locationName;
                kingdomId = tile.settlement.kingdom || kingdomId;
            }
        }

        // Detect witnesses within radius
        const witnessRadius = data.witnessRadius || 5;
        const witnesses = this._detectWitnesses(victim, witnessRadius, opts.scene);

        // Track kill stats
        if (crimeType === 'murder' || rumorTypeId.includes('murder')) {
            player.gossip.totalKills++;
            if (witnesses.length > 0) {
                player.gossip.witnessedKills++;
            } else {
                player.gossip.unwitnessedKills++;
            }
        }

        // No witnesses — the crime goes unnoticed (for now)
        if (witnesses.length === 0) {
            return { witnessed: false, witnessCount: 0, rumor: null, witnesses: [] };
        }

        // Compute credibility based on witness count and types
        const credibility = this._computeCredibility(witnesses, data.credibility || {});

        // Create the rumor
        const rumor = {
            id: player.gossip.nextRumorId++,
            type: rumorTypeId,
            perpetrator: player.name,
            victim: { name: victim.name, type: victim.type, icon: victim.icon || '❓' },
            locationQ: q,
            locationR: r,
            locationName,
            kingdom: kingdomId,
            dayCreated: (world && world.day) || 0,
            credibility,
            severity: rumorTypeDef.baseSeverity * credibility,
            witnessCount: witnesses.length,
            witnessNames: witnesses.slice(0, 3).map(w => w.name),
            spreadTo: kingdomId ? [`${q},${r}`] : [],  // Starts at origin settlement
            consequencesApplied: {},  // { settlementKey: { repApplied, bountyApplied, ... } }
            expired: false,
        };

        // Cap active rumors
        const maxRumors = data.maxActiveRumors || 100;
        if (player.gossip.rumors.length >= maxRumors) {
            // Expire the oldest rumor
            player.gossip.rumors.shift();
        }
        player.gossip.rumors.push(rumor);

        // Immediate karma hit
        player.karma = Math.max(-100, (player.karma || 0) + (rumorTypeDef.karmaPenalty || 0));

        // Immediate reputation hit at the crime location's kingdom
        if (kingdomId && player.reputation) {
            const immediatePenalty = Math.floor((rumorTypeDef.reputationPenalty || 0) * credibility);
            player.reputation[kingdomId] = (player.reputation[kingdomId] || 0) + immediatePenalty;
        }

        // Immediate renown hit
        player.renown = Math.max(0, (player.renown || 0) + (rumorTypeDef.renownPenalty || 0));

        return {
            witnessed: true,
            witnessCount: witnesses.length,
            rumor,
            witnesses,
        };
    },

    // ══════════════════════════════════════════════
    // DEEDS — the player's notable acts become talk
    // ══════════════════════════════════════════════

    /**
     * Spread word of a notable deed of the player's (a sack, a famine dole, a
     * pardon, a duel won): a rumour of a `deed: true` type that starts at the
     * settlement where it happened (or the nearest one), spreads and fades like
     * any rumour, but carries no bounty, reputation loss or guard hostility —
     * the deed's own effects are applied by whoever reported it. Townsfolk talk
     * about it (systems/chatter.js), the tavern repeats it. Draws no RNG.
     * @param {Object} opts - { q, r, location, kingdom, victim }
     * @returns {Object|null} the rumour
     */
    spreadDeed(player, world, deedType, opts = {}) {
        if (!player) return null;
        this.initializePlayer(player);
        const data = this._getData();
        const def = data && data.rumorTypes ? data.rumorTypes[deedType] : null;
        if (!def || !(def.deed || def.talk)) return null;

        // Where the talk starts: the settlement itself, or the nearest one
        let at = null;
        if (world && opts.q != null) {
            const tile = world.getTile ? world.getTile(opts.q, opts.r) : null;
            if (tile && tile.settlement) at = { q: opts.q, r: opts.r, name: tile.settlement.name, kingdom: tile.settlement.kingdom };
            else at = this._nearestSettlement(world, opts.q, opts.r, (data.spreadSettings && data.spreadSettings.maxSpreadDistance) || 3);
        }
        const day = (world && world.day) || 0;
        const location = opts.location || (at && at.name) || 'the wilds';
        // The same deed in the same place on the same day is one story
        const dup = player.gossip.rumors.find(rm => !rm.expired && rm.type === deedType && rm.dayCreated === day && rm.locationName === location);
        if (dup) return dup;

        const credibility = def.credibility != null ? def.credibility : 0.9;
        const rumor = {
            id: player.gossip.nextRumorId++,
            type: deedType,
            deed: !!def.deed,
            talk: !!def.talk,
            perpetrator: player.name,
            victim: { name: opts.victim || 'someone', type: 'deed', icon: def.icon || '🗣️' },
            locationQ: at ? at.q : opts.q,
            locationR: at ? at.r : opts.r,
            locationName: location,
            kingdom: opts.kingdom || (at && at.kingdom) || null,
            dayCreated: day,
            credibility,
            severity: (def.baseSeverity || 20) * credibility,
            witnessCount: 0,
            witnessNames: [],
            spreadTo: at ? [`${at.q},${at.r}`] : [],
            consequencesApplied: {},
            expired: false,
        };
        const maxRumors = data.maxActiveRumors || 100;
        if (player.gossip.rumors.length >= maxRumors) player.gossip.rumors.shift();
        player.gossip.rumors.push(rumor);
        return rumor;
    },

    /**
     * A misdeed of the player's that comes out without witnesses — a whisper
     * campaign traced back, a blackmail gone wrong (systems/whispers.js): a
     * rumour of a crime type starting at (q, r) with the type's immediate
     * karma/reputation/renown hit, spreading and biting like any crime rumour.
     * Draws no RNG.
     * @param {Object} opts - { q, r, victim, credibility }
     * @returns {Object|null} the rumour
     */
    accuse(player, world, typeId, opts = {}) {
        if (!player) return null;
        this.initializePlayer(player);
        const data = this._getData();
        const def = data && data.rumorTypes ? data.rumorTypes[typeId] : null;
        if (!def || def.deed || def.talk) return null;
        let at = null;
        if (world && opts.q != null) {
            const tile = world.getTile ? world.getTile(opts.q, opts.r) : null;
            if (tile && tile.settlement) at = { q: opts.q, r: opts.r, name: tile.settlement.name, kingdom: tile.settlement.kingdom };
            else at = this._nearestSettlement(world, opts.q, opts.r, (data.spreadSettings && data.spreadSettings.maxSpreadDistance) || 3);
        }
        const credibility = Utils.clamp(opts.credibility != null ? opts.credibility : 0.85, 0, 1);
        const rumor = {
            id: player.gossip.nextRumorId++,
            type: typeId,
            perpetrator: player.name,
            victim: { name: opts.victim || 'someone', type: 'noble', icon: def.icon || '🗣️' },
            locationQ: at ? at.q : opts.q,
            locationR: at ? at.r : opts.r,
            locationName: (at && at.name) || 'the wilds',
            kingdom: (at && at.kingdom) || null,
            dayCreated: (world && world.day) || 0,
            credibility,
            severity: (def.baseSeverity || 20) * credibility,
            witnessCount: 0,
            witnessNames: [],
            spreadTo: at ? [`${at.q},${at.r}`] : [],
            consequencesApplied: {},
            expired: false,
        };
        const maxRumors = data.maxActiveRumors || 100;
        if (player.gossip.rumors.length >= maxRumors) player.gossip.rumors.shift();
        player.gossip.rumors.push(rumor);
        player.karma = Math.max(-100, (player.karma || 0) + (def.karmaPenalty || 0));
        if (rumor.kingdom && player.reputation) {
            player.reputation[rumor.kingdom] = (player.reputation[rumor.kingdom] || 0) + Math.floor((def.reputationPenalty || 0) * credibility);
        }
        player.renown = Math.max(0, (player.renown || 0) + (def.renownPenalty || 0));
        return rumor;
    },

    /**
     * Every settlement ({ q, r, name, kingdom, … }, read-only): the world's
     * own scan of its tiles. A generated world keeps its settlements on the
     * tiles, not on kingdom.settlements; small hand-made worlds (tests) that
     * have no scan list them on their kingdoms.
     */
    _settlements(world) {
        if (world && typeof world.getSettlementViews === 'function') return world.getSettlementViews();
        const out = [];
        for (const k of (world && world.kingdoms) || []) {
            for (const s of k.settlements || []) out.push(s.kingdom ? s : { ...s, kingdom: k.id });
        }
        return out;
    },

    /** The nearest settlement to (q, r) within maxDist hexes: { q, r, name, kingdom } or null. */
    _nearestSettlement(world, q, r, maxDist) {
        let best = null;
        let bestD = Infinity;
        for (const s of this._settlements(world)) {
            const d = Hex.wrappingDistance(q, r, s.q, s.r, world.width);
            if (d <= maxDist && d < bestD) { best = { q: s.q, r: s.r, name: s.name, kingdom: s.kingdom || null }; bestD = d; }
        }
        return best;
    },

    /** Is this rumour about one of the player's deeds (not a crime)? */
    isDeed(rumor) {
        if (!rumor) return false;
        if (rumor.deed) return true;
        const def = this._getRumorType(rumor.type);
        return !!(def && def.deed);
    },

    /** Is this rumour talk that carries no penalty of its own (a deed, or idle talk such as an affair)? */
    isTalk(rumor) {
        if (!rumor) return false;
        if (rumor.deed || rumor.talk) return true;
        const def = this._getRumorType(rumor.type);
        return !!(def && (def.deed || def.talk));
    },

    // ══════════════════════════════════════════════
    // TELLINGS — rumours grow (and shrink, and wander) in the telling
    // ══════════════════════════════════════════════

    /** Which telling list (data/gossip.json → tellings) a rumour type draws from. */
    _tellingKind(typeDef) {
        if (typeDef && typeDef.deed) return 'deed';
        if (typeDef && typeDef.talk) return 'talk';
        return 'crime';
    },

    /** The telling a rumour has in a settlement ("q,r"), or null for the plain truth. */
    tellingAt(rumor, key) {
        const t = rumor && rumor.tellings && rumor.tellings[key];
        if (!t) return null;
        const data = this._getData();
        const tellings = data && data.tellings;
        if (!tellings) return null;
        if (t.id === 'refuted') return tellings.refuted ? { ...tellings.refuted, who: t.who || null } : null;
        const def = this._getRumorType(rumor.type);
        const list = tellings[this._tellingKind(def)] || [];
        const found = list.find(x => x.id === t.id);
        return found ? { ...found, who: t.who || null } : null;
    },

    /** The rumour's severity as told in one settlement (its telling scales it). */
    localSeverity(rumor, key) {
        const t = this.tellingAt(rumor, key);
        const mult = t && Number.isFinite(t.severity) ? t.severity : 1;
        return (rumor.severity || 0) * mult;
    },

    /**
     * How much a deed's word is worth where it is told, 0.. (1 = a plain,
     * fresh telling of a deed of the deed scale's reference severity): its
     * local severity (fades with age; a legend tells bigger) over
     * deedRenown.refSeverity, times the telling's `regard` (data/gossip.json
     * tellings.deed: a soured telling counts for little, a stolen one for
     * nothing). 0 for anything that is not a deed.
     */
    deedWeight(rumor, key) {
        if (!this.isDeed(rumor)) return 0;
        const data = this._getData() || {};
        const cfg = { refSeverity: 30, minWeight: 0, maxWeight: 2.5, ...(data.deedRenown || {}) };
        const t = this.tellingAt(rumor, key);
        const regard = t && Number.isFinite(t.regard) ? t.regard : (t && t.stolen ? 0 : 1);
        const w = (this.localSeverity(rumor, key) / Math.max(1, cfg.refSeverity)) * regard;
        return Utils.clamp(w, cfg.minWeight, cfg.maxWeight);
    },

    /** The rumour's text as told in one settlement (the plain description without a key). */
    describeAt(rumor, key = null) {
        const def = this._getRumorType(rumor.type);
        const fill = s => String(s || '')
            .replace(/\{perpetrator\}/g, rumor.perpetrator)
            .replace(/\{victim\}/g, rumor.victim ? rumor.victim.name : 'someone')
            .replace(/\{location\}/g, rumor.locationName);
        const base = fill(def ? def.description : rumor.type);
        const t = key != null ? this.tellingAt(rumor, key) : null;
        if (!t || !t.text) return base;
        return fill(t.text).replace(/\{base\}/g, base).replace(/\{rival\}/g, t.who || 'some sellsword');
    },

    /**
     * A rumour reaches a new settlement: the teller passes on the version they
     * heard, or changes it. Draws from the RNG only when a rumour spreads.
     * @param {string|null} rivalName - who a deed may be credited to instead
     */
    _retell(rumor, typeDef, fromKey, toKey, rivalName = null) {
        const data = this._getData();
        const cfg = data && data.tellings;
        if (!cfg) return;
        if (!rumor.tellings) rumor.tellings = {};
        const from = rumor.tellings[fromKey] || null;
        const depth = ((from && from.d) || 0) + 1;
        if (from && Utils.random() < (cfg.inherit ?? 0.65)) {
            rumor.tellings[toKey] = { ...from, d: depth };
            return;
        }
        if (Utils.random() >= (cfg.chance ?? 0.35)) return;
        const list = (cfg[this._tellingKind(typeDef)] || [])
            .filter(t => depth >= (t.minDepth || 0) && (!t.needsRival || rivalName));
        if (!list.length) return;
        const total = list.reduce((s, t) => s + (t.weight || 1), 0);
        let roll = Utils.random() * total;
        let pick = list[list.length - 1];
        for (const t of list) {
            roll -= (t.weight || 1);
            if (roll < 0) { pick = t; break; }
        }
        rumor.tellings[toKey] = { id: pick.id, d: depth, ...(pick.needsRival ? { who: rivalName } : {}) };
    },

    /**
     * Sing a rumour down in one settlement (a bard paid to tell it the other
     * way): the telling there becomes 'refuted' and spreads on as such.
     * @returns {boolean} whether it took
     */
    refute(player, rumorId, key) {
        this.initializePlayer(player);
        const rumor = player.gossip.rumors.find(r => r.id === rumorId && !r.expired);
        if (!rumor || !(rumor.spreadTo || []).includes(key) || this.isTalk(rumor)) return false;
        if (!rumor.tellings) rumor.tellings = {};
        rumor.tellings[key] = { id: 'refuted', d: 0 };
        return true;
    },

    /**
     * A friend who heard a false charge against the player hears the player's
     * side and tells it about town: sung down there (as refute) and the tale
     * loses `share` of its credibility everywhere (its severity, and so its
     * bounties and reputation costs, follow).
     * @returns {boolean} whether there was such a tale to discredit
     */
    discredit(player, rumorId, key, share = 0.3) {
        this.initializePlayer(player);
        const rumor = player.gossip.rumors.find(r => r.id === rumorId && !r.expired);
        if (!rumor || this.isTalk(rumor)) return false;
        if (key && (rumor.spreadTo || []).includes(key)) {
            if (!rumor.tellings) rumor.tellings = {};
            rumor.tellings[key] = { id: 'refuted', d: 0 };
        }
        rumor.credibility = Math.max(0, (Number.isFinite(rumor.credibility) ? rumor.credibility : 1) * (1 - share));
        if (Number.isFinite(rumor.severity)) rumor.severity *= (1 - share);
        return true;
    },

    /** Who a stolen deed is pinned on: the most renowned living rival adventurer. */
    _rivalName(player) {
        const list = player && player.rivals && Array.isArray(player.rivals.list) ? player.rivals.list : [];
        const best = list.filter(r => r && !r.dead).sort((a, b) => (b.renown || 0) - (a.renown || 0))[0];
        return best ? best.name : null;
    },

    // ══════════════════════════════════════════════
    // WITNESS DETECTION
    // ══════════════════════════════════════════════

    /**
     * Find NPCs within radius of the crime scene.
     * @param {Object} victim - { name, type }
     * @param {number} radius - tiles (Chebyshev distance)
     * @param {Object} [scene] - { npcs, q, r }: bystanders and the crime's
     *   inner-map position, passed in by the caller. No scene → no witnesses.
     */
    _detectWitnesses(victim, radius, scene) {
        if (!scene || !Array.isArray(scene.npcs)) return [];
        const witnesses = [];
        for (const npc of scene.npcs) {
            // Skip the victim
            if (npc.name === victim.name && npc.type === victim.type) continue;
            const dist = Math.max(Math.abs(npc.q - scene.q), Math.abs(npc.r - scene.r));
            if (dist <= radius) {
                witnesses.push({ name: npc.name, type: npc.type, id: npc.id, distance: dist });
            }
        }
        return witnesses;
    },

    /**
     * Compute rumor credibility based on witness quality.
     */
    _computeCredibility(witnesses, credConfig) {
        let base;
        if (witnesses.length >= 3) {
            base = credConfig.threeOrMore || 0.95;
        } else if (witnesses.length === 2) {
            base = credConfig.twoWitnesses || 0.75;
        } else {
            base = credConfig.singleWitness || 0.5;
        }

        // Bonus for guard or noble witnesses
        for (const w of witnesses) {
            if (w.type === 'guard') base = Math.min(1, base + (credConfig.guardWitnessBonus || 0.3));
            if (w.type === 'noble') base = Math.min(1, base + (credConfig.nobleWitnessBonus || 0.2));
        }

        return Math.min(1, base);
    },

    // ══════════════════════════════════════════════
    // DAILY PROCESSING — rumor spread & decay
    // ══════════════════════════════════════════════

    /**
     * Process gossip daily: spread rumors, apply consequences, decay old ones.
     * Called from game.js during the daily turn.
     * @returns {{ newConsequences: Object[], expiredRumors: number }}
     */
    processDaily(player, world) {
        this.initializePlayer(player);
        const data = this._getData();
        if (!data || !world) return { newConsequences: [], expiredRumors: 0 };

        const day = world.day || 0;
        const consequences = [];
        let expired = 0;

        // How fast rumors fade: 1 = over their full decayDays, 2 = twice as fast…
        const decayRate = data.decayRate ?? 1;
        // How many live rumors a single settlement can be buzzing with at once
        const maxPerSettlement = data.maxRumorsPerSettlement ?? 30;
        const settlementLoad = this._settlementRumorLoad(player.gossip.rumors);

        for (const rumor of player.gossip.rumors) {
            if (rumor.expired) continue;

            const typeDef = data.rumorTypes[rumor.type] || data.rumorTypes.murder;

            // ── Decay check ──
            const decayDays = typeDef.decayDays || 60;
            const age = (day - rumor.dayCreated) * decayRate;
            if (age >= decayDays) {
                rumor.expired = true;
                for (const key of rumor.spreadTo || []) {
                    settlementLoad.set(key, Math.max(0, (settlementLoad.get(key) || 0) - 1));
                }
                expired++;
                // Remove associated bounties
                player.gossip.bounties = player.gossip.bounties.filter(b => b.rumorId !== rumor.id);
                continue;
            }

            // Gradual severity decay (age is already scaled by decayRate)
            rumor.severity = typeDef.baseSeverity * rumor.credibility * Math.max(0, 1 - (age / decayDays));

            // ── Spread to nearby settlements ──
            const spreadSettings = data.spreadSettings || {};
            const spreadCount = spreadSettings.spreadPerDay || 1;

            const rivalName = typeDef.deed ? this._rivalName(player) : null;
            for (let i = 0; i < spreadCount; i++) {
                this._spreadRumor(rumor, typeDef, world, spreadSettings, settlementLoad, maxPerSettlement, rivalName);
            }

            // ── A deed raises the player's name in the realms it is told in ──
            // (once per town, by how big it is told there: a legend more, a
            // soured telling little, a stolen one nothing — Gossip.deedWeight)
            if (typeDef.deed) {
                const dr = data.deedRenown || {};
                if (typeDef.localRenown === false || !player.reputation) continue;
                for (const settlementKey of rumor.spreadTo) {
                    if (rumor.consequencesApplied[settlementKey]) continue;
                    const [sq, sr] = settlementKey.split(',').map(Number);
                    const tile = world.getTile ? world.getTile(sq, sr) : null;
                    if (!tile || !tile.settlement) continue;
                    const kId = tile.settlement.kingdom;
                    const gain = Math.round(this.deedWeight(rumor, settlementKey) * (Number.isFinite(dr.reputationPerTown) ? dr.reputationPerTown : 2));
                    rumor.consequencesApplied[settlementKey] = { deed: true, repGain: gain };
                    if (kId && gain > 0) {
                        const cap = Number.isFinite(dr.reputationCap) ? dr.reputationCap : 60;
                        const cur = player.reputation[kId] || 0;
                        if (cur < cap) player.reputation[kId] = Math.min(cap, cur + gain);
                    }
                }
                continue;
            }
            // ── Apply consequences at each settlement that has the rumor ──
            // (idle talk is not a crime: no bounty, no reputation loss)
            if (typeDef.talk) continue;
            const thresholds = data.consequenceThresholds || {};
            for (const settlementKey of rumor.spreadTo) {
                if (rumor.consequencesApplied[settlementKey]) continue;

                const [sq, sr] = settlementKey.split(',').map(Number);
                const tile = world.getTile ? world.getTile(sq, sr) : null;
                if (!tile || !tile.settlement) continue;

                const sKingdom = tile.settlement.kingdom;
                const result = this._applyConsequences(player, rumor, sKingdom, thresholds, day, this.localSeverity(rumor, settlementKey));
                rumor.consequencesApplied[settlementKey] = result;
                if (result.consequence) {
                    consequences.push({
                        ...result,
                        settlementName: tile.settlement.name,
                        rumorType: rumor.type,
                    });
                }
            }
        }

        // The crown forgets in time: old bounties and warrants lapse
        const forgiveness = data.forgivenessDays || 90;
        player.gossip.bounties = player.gossip.bounties.filter(b => day - (b.issuedDay || 0) < forgiveness);
        for (const [kingdomId, w] of Object.entries(player.gossip.warrants || {})) {
            if (day - (w.issuedDay || 0) >= forgiveness) delete player.gossip.warrants[kingdomId];
        }

        // Clean up fully expired rumors (keep last 20 for history)
        const active = player.gossip.rumors.filter(r => !r.expired);
        const expiredList = player.gossip.rumors.filter(r => r.expired);
        player.gossip.rumors = [...active, ...expiredList.slice(-20)];

        return { newConsequences: consequences, expiredRumors: expired };
    },

    /**
     * Count live rumors per settlement key ("q,r").
     * @returns {Map<string, number>}
     */
    _settlementRumorLoad(rumors) {
        const load = new Map();
        for (const rumor of rumors || []) {
            if (rumor.expired) continue;
            for (const key of rumor.spreadTo || []) {
                load.set(key, (load.get(key) || 0) + 1);
            }
        }
        return load;
    },

    /**
     * Spread a rumor to an adjacent settlement.
     * Settlements already holding `maxPerSettlement` live rumors don't take new ones.
     */
    _spreadRumor(rumor, typeDef, world, settings, load = null, maxPerSettlement = Infinity, rivalName = null) {
        if (!rumor.spreadTo || rumor.spreadTo.length === 0) return;
        const maxDist = settings.maxSpreadDistance || 3;
        const baseChance = (typeDef.spreadChance || 0.5) * (settings.baseSpreadChance || 0.3);

        // Pick a random source settlement it's already at
        const sourceKey = rumor.spreadTo[Math.floor(Utils.random() * rumor.spreadTo.length)];
        const [sq, sr] = sourceKey.split(',').map(Number);

        // Find nearby settlements within maxDist hexes
        for (const settlement of this._settlements(world)) {
            const sKey = `${settlement.q},${settlement.r}`;
            if (rumor.spreadTo.includes(sKey)) continue; // Already knows
            if (load && (load.get(sKey) || 0) >= maxPerSettlement) continue; // Saturated with gossip

            const dist = Hex.wrappingDistance(sq, sr, settlement.q, settlement.r, world.width);
            if (dist > maxDist) continue;

            // Closer settlements are more likely to hear the rumor
            const distFactor = 1 - (dist / (maxDist + 1));
            const chance = baseChance * distFactor;

            // Trade route bonus
            let tradeBonus = 0;
            if (settings.tradeRouteBonus && this._hasTradeRoute(world, sq, sr, settlement.q, settlement.r)) {
                tradeBonus = settings.tradeRouteBonus;
            }

            if (Utils.random() < chance + tradeBonus) {
                rumor.spreadTo.push(sKey);
                if (load) load.set(sKey, (load.get(sKey) || 0) + 1);
                this._retell(rumor, typeDef, sourceKey, sKey, rivalName);
                return; // One spread per call
            }
        }
    },

    /**
     * Check if two settlements have an active caravan route between them.
     */
    _hasTradeRoute(world, q1, r1, q2, r2) {
        if (!world.units) return false;
        return world.units.some(u =>
            u.type === 'caravan' && !u.destroyed && (
                (u.originQ === q1 && u.originR === r1 && u.destQ === q2 && u.destR === r2) ||
                (u.originQ === q2 && u.originR === r2 && u.destQ === q1 && u.destR === r1)
            )
        );
    },

    /**
     * Apply consequences of a rumor reaching a settlement.
     * Returns { consequence ('bounty' | 'warrant' | 'reputation' | null), repLoss, repApplied, bountyApplied }
     */
    _applyConsequences(player, rumor, kingdomId, thresholds, day, severity = rumor.severity) {
        const result = { consequence: null, repApplied: false, bountyApplied: false };
        if (!kingdomId) return result;

        // Reputation penalty when rumor spreads to new kingdom territory —
        // once per realm, however many of its towns the rumour reaches
        if (!Array.isArray(rumor.repKingdoms)) rumor.repKingdoms = [];
        if (player.reputation && severity >= 10 && !rumor.repKingdoms.includes(kingdomId)) {
            const penalty = Math.floor(-severity * 0.3);
            player.reputation[kingdomId] = Math.max(-100, (player.reputation[kingdomId] || 0) + penalty);
            rumor.repKingdoms.push(kingdomId);
            result.repApplied = true;
            result.repLoss = penalty;
        }

        // Bounty issued
        if (severity >= (thresholds.bountyIssued || 50)) {
            const existing = player.gossip.bounties.find(b => b.rumorId === rumor.id && b.kingdom === kingdomId);
            if (!existing) {
                const typeDef = this._getRumorType(rumor.type);
                const bountyGold = typeDef ? typeDef.bountyGold : 100;
                player.gossip.bounties.push({
                    rumorId: rumor.id,
                    kingdom: kingdomId,
                    gold: Math.floor(bountyGold * rumor.credibility),
                    issuedDay: day,
                    description: rumor.type,
                });
                result.bountyApplied = true;
                result.consequence = 'bounty';
            }
        }

        // Kingdom-level warrant (very severe) — every settlement of the crown refuses you
        if (severity >= (thresholds.kingdomWarrant || 90)) {
            result.consequence = 'warrant';
            if (!player.gossip.warrants) player.gossip.warrants = {};
            if (!player.gossip.warrants[kingdomId]) {
                player.gossip.warrants[kingdomId] = { issuedDay: day, rumorId: rumor.id };
            }
        }

        // Nothing graver, but the realm thinks less of you: reported all the same
        if (!result.consequence && result.repApplied) result.consequence = 'reputation';

        return result;
    },

    // ══════════════════════════════════════════════
    // GUARD HOSTILITY CHECK
    // ══════════════════════════════════════════════

    /**
     * Check if guards at a settlement should be hostile to the player.
     * Called when entering an inner map to potentially make guards attack.
     * @returns {{ hostile: boolean, reason: string|null, bountyTotal: number }}
     */
    checkGuardHostility(player, worldQ, worldR, world) {
        this.initializePlayer(player);
        const data = this._getData();
        if (!data) return { hostile: false, reason: null, bountyTotal: 0 };

        const tile = world && world.getTile ? world.getTile(worldQ, worldR) : null;
        if (!tile || !tile.settlement) return { hostile: false, reason: null, bountyTotal: 0 };

        const kingdom = tile.settlement.kingdom;
        const settlementKey = `${worldQ},${worldR}`;
        const thresholds = data.consequenceThresholds || {};

        let maxSeverity = 0;
        let bountyTotal = 0;
        let reason = null;

        for (const rumor of player.gossip.rumors) {
            if (rumor.expired) continue;
            if (!rumor.spreadTo.includes(settlementKey)) continue;
            if (this.isTalk(rumor)) continue; // talk of deeds (or of your love life) doesn't set the guards on you
            // Settled with this crown's guards — no longer held against you here
            if (rumor.pardonedIn && rumor.pardonedIn.includes(kingdom)) continue;

            // As it is told here: a story pinned on a stranger, or sung down, frightens no guard
            const local = this.localSeverity(rumor, settlementKey);
            if (local > maxSeverity) {
                maxSeverity = local;
                reason = data.rumorTypes[rumor.type] ? this.describeAt(rumor, settlementKey) : 'criminal activity';
            }

            // Sum bounties from this kingdom
            for (const b of player.gossip.bounties) {
                if (b.rumorId === rumor.id && b.kingdom === kingdom) {
                    bountyTotal += b.gold;
                }
            }
        }

        const hostile = maxSeverity >= (thresholds.guardHostile || 60);
        const banned = maxSeverity >= (thresholds.settlementBanned || 80);
        const warrant = !!(kingdom && player.gossip.warrants && player.gossip.warrants[kingdom]);
        return { hostile, banned, warrant, reason, bountyTotal };
    },

    /**
     * Whether merchants and officials here turn the player away: the rumours
     * are bad enough to ban them, or the crown has a warrant out.
     * @returns {{ refused: boolean, reason: string|null }}
     */
    refusesService(player, worldQ, worldR, world) {
        const st = this.checkGuardHostility(player, worldQ, worldR, world);
        if (st.warrant) return { refused: true, reason: 'There is a warrant out for you across this realm. Settle it with the guards first.' };
        if (st.banned) return { refused: true, reason: `Word of ${st.reason || 'your crimes'} has reached this place. No one here will deal with you until you answer to the guards.` };
        return { refused: false, reason: null };
    },

    /** Gold owed in gossip bounties to one kingdom. */
    bountyTotalForKingdom(player, kingdomId) {
        this.initializePlayer(player);
        return player.gossip.bounties
            .filter(b => b.kingdom === kingdomId)
            .reduce((sum, b) => sum + (b.gold || 0), 0);
    },

    /**
     * Answer for your crimes in a kingdom: its bounties and warrant are
     * dropped and the rumours there no longer turn its guards against you.
     */
    settleWithKingdom(player, kingdomId) {
        this.initializePlayer(player);
        const owed = player.gossip.bounties.filter(b => b.kingdom === kingdomId);
        for (const b of owed) {
            const rumor = player.gossip.rumors.find(r => r.id === b.rumorId);
            if (rumor) {
                if (!rumor.pardonedIn) rumor.pardonedIn = [];
                if (!rumor.pardonedIn.includes(kingdomId)) rumor.pardonedIn.push(kingdomId);
            }
        }
        player.gossip.bounties = player.gossip.bounties.filter(b => b.kingdom !== kingdomId);
        if (player.gossip.warrants) delete player.gossip.warrants[kingdomId];
        // Answering to the guards also cools underworld heat below the poster line
        const uw = player.underworld && player.underworld.heat;
        if (uw && uw[kingdomId] > 20) uw[kingdomId] = 20;
        if (player.underworld && player.underworld.posters) delete player.underworld.posters[kingdomId];
        return owed.length;
    },

    // ══════════════════════════════════════════════
    // TAVERN GOSSIP — hear rumors about yourself
    // ══════════════════════════════════════════════

    /**
     * Get rumors that can be heard at a tavern in a given settlement.
     * Returns formatted strings for display.
     */
    getTavernGossip(player, worldQ, worldR, world) {
        this.initializePlayer(player);
        const data = this._getData();
        if (!data) return [];

        const settlementKey = `${worldQ},${worldR}`;
        const gossipItems = [];

        for (const rumor of player.gossip.rumors) {
            if (rumor.expired) continue;
            if (!rumor.spreadTo.includes(settlementKey)) continue;

            const typeDef = data.rumorTypes[rumor.type];
            if (!typeDef) continue;

            const desc = this.describeAt(rumor, settlementKey);
            const telling = this.tellingAt(rumor, settlementKey);

            const age = (world.day || 0) - rumor.dayCreated;
            let freshness;
            if (age <= 3) freshness = 'Just happened!';
            else if (age <= 10) freshness = 'Recent news';
            else if (age <= 30) freshness = 'Old news';
            else freshness = 'Fading memory';

            const hasBounty = player.gossip.bounties.some(b => b.rumorId === rumor.id);

            gossipItems.push({
                id: rumor.id,
                icon: typeDef.icon,
                text: desc,
                freshness,
                severity: rumor.severity,
                hasBounty,
                bountyGold: hasBounty ? player.gossip.bounties.find(b => b.rumorId === rumor.id)?.gold : 0,
                deed: !!typeDef.deed,
                talk: !!typeDef.talk,
                telling: telling ? { id: telling.id, label: telling.label, clears: !!telling.clears, stolen: !!telling.stolen } : null,
                refutable: !typeDef.deed && !typeDef.talk && !(telling && telling.id === 'refuted'),
                label: typeDef.label || rumor.type,
                known: player.gossip.knownRumors.includes(rumor.id),
            });

            // Mark as known
            if (!player.gossip.knownRumors.includes(rumor.id)) {
                player.gossip.knownRumors.push(rumor.id);
            }
        }

        return gossipItems;
    },

    /**
     * Get a summary of the player's criminal reputation for UI display.
     */
    getPlayerNotoriety(player) {
        this.initializePlayer(player);
        const rumors = player.gossip.rumors.filter(r => !r.expired && !this.isTalk(r));
        const bounties = player.gossip.bounties;
        const totalBounty = bounties.reduce((sum, b) => sum + b.gold, 0);

        let notoriety = 'Unknown';
        if (totalBounty >= 1000) notoriety = 'Infamous Murderer';
        else if (totalBounty >= 500) notoriety = 'Notorious Criminal';
        else if (totalBounty >= 200) notoriety = 'Wanted Outlaw';
        else if (totalBounty >= 50) notoriety = 'Suspected Criminal';
        else if (rumors.length > 0) notoriety = 'Rumored Troublemaker';

        return {
            notoriety,
            activeRumors: rumors.length,
            activeBounties: bounties.length,
            totalBounty,
            kills: player.gossip.totalKills,
            witnessedKills: player.gossip.witnessedKills,
            unwitnessedKills: player.gossip.unwitnessedKills,
        };
    },

    // ══════════════════════════════════════════════
    // SERIALIZATION HELPERS
    // ══════════════════════════════════════════════

    /**
     * Prepare gossip data for save file.
     */
    serialize(player) {
        if (!player.gossip) return null;
        return { ...player.gossip };
    },
};
