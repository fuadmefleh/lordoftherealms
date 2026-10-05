// ============================================
// THRONE — Claims & Crowns: the path from lord to ruler
// ============================================
// The long game. The player earns *claims* on a kingdom's throne (a royal
// marriage, forged documents, a royal office held long enough, conquering the
// capital, or Prestige spent on heralds), each adding to the claim's strength.
//
// When an AI ruler dies (Characters.handleSuccession records it on
// kingdom.lastSuccession), a regency, a weak or distant heir or a rival of the
// blood can spark a *succession crisis*. The player may back a claimant with
// gold, Prestige or the sword for a reward, or press their own claim.
//
// *Pressing a claim* raises the banners: the realm's settlements and great
// lords (the royal council) choose sides by the player's appeal, the realm
// fights a civil war (loyalist war hosts march through RealmWars, field battles
// are fought daily and by the player's own army), and it ends with a crown or
// with exile.
//
// A crowned player *rules*: they take a levy from the royal treasury, set tax,
// war-stance and faith policies (fed to the kingdom AI through kingdom.crown,
// read by KingdomBonuses.get and KingdomAI.considerWar) and conduct the
// realm's diplomacy. Alternatively the player may *found* a kingdom of their
// own from held settlements — a real kingdom the simulation treats normally.
//
// State lives on player.throne (saved with the player); kingdom.crown mirrors
// what the world layer needs and is rebuilt by syncCrowns. Tunables and text
// live in data/throne.json. Randomness flows through Utils only.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { Kingdom } from '../world/kingdom.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { NPCLords } from '../world/npcLords.js';
import { Characters } from '../world/characters.js';
import { House } from './house.js';
import { RealmWars } from './realmWars.js';
import { Titles } from './titles.js';
import { Traits } from './traits.js';
import { Relationships } from './relationships.js';

// Code defaults (data/throne.json → config overrides them key by key).
const DEFAULT_CONFIG = {
    maxClaimStrength: 100, pressMinStrength: 25, pressGold: 300, pressMinArmy: 40,
    exileDays: 360, exilePrestigeLoss: 30, exileReputation: -80,
    crownedPrestige: 50, crownedRenown: 60, crownedReputation: 50,
    marriageBase: 30, marriagePerChild: 8, marriageChildCap: 24,
    royalMatchPrestige: 20, royalMatchGold: 500, royalMatchMinReputation: 20,
    forgeGold: 300, forgeStrength: 15, forgeCap: 30, forgeBase: 0.4, forgePerSpyLevel: 0.1,
    forgePerStealth: 0.02, forgeFailReputation: -15, forgeFailSpyLoyalty: -10,
    purchasePrestige: 30, purchaseStrength: 15, purchaseCap: 30,
    conquestStrength: 35,
    officeClaims: { 2: { days: 360, strength: 10 }, 3: { days: 240, strength: 20 }, 4: { days: 180, strength: 30 } },
    lean: {
        claimWeight: 0.5, reputationWeight: 0.25, prestigePer: 5, prestigeCap: 15,
        opinionWeight: 0.3, opinionCap: 15, traitCap: 10, stabilityPivot: 60, stabilityWeight: 0.3,
        crisisBonus: 15, armyPer: 20, armyCap: 15, crownLoyalty: 35, settlementNoise: 12,
        capitalPenalty: 25, distancePer: 0.5, distanceCap: 10, holdingBonus: 8,
        advisorNoise: 10, advisorLoyaltyWeight: 0.5, waver: 5,
    },
    civilWar: {
        levyShare: 0.8, advisorMomentum: 3, battleChance: 0.3, fieldShare: 0.6, momentumPerBattle: 6,
        loyalistLoss: 0.05, rebelLoss: 0.07, flipChance: 0.35, driftPivot: 0.45, driftWeight: 2,
        levyRegen: 0.02, hostScoreWeight: 0.5, victoryMomentum: 100, defeatMomentum: -100, maxDays: 360,
        lateVictoryMomentum: 30, collapseDays: 10, stabilityMod: -0.15,
        vanguardShare: 0.08, vanguardMin: 20, vanguardMax: 400, vanguardWin: 10, vanguardLoss: -8,
    },
    crisis: {
        chance: { regent: 0.6, distant_relative: 0.8, young_heir: 0.35, disputed: 1.0, heir: 0.08 },
        youngHeirAge: 20, durationDays: 60, stabilityMod: -0.1, rivalSupport: [25, 45],
        incumbentSupport: { heir: 60, young_heir: 45, regent: 40, distant_relative: 35, disputed: 35 },
        goldPerSupport: 50, minGold: 200, prestigeCost: 10, prestigeSupport: 12, battleSupport: 15,
        rewardGoldMultiplier: 1.5, rewardGold: 200, rewardReputation: 30, rewardPrestige: 15, loserReputation: -20,
    },
    ruling: {
        levyReserve: 500, levyCap: 200, peaceCooldownDays: 10, peaceBaseChance: 0.35, allianceMinRelations: 40,
        giftCost: 300, giftRelations: 10, peaceSeekChance: 0.05,
    },
    founding: {
        minSettlements: 3, minPrestige: 50, prestigeCost: 25, minMilitary: 80, militaryPerPopulation: 0.07,
        treasuryFloor: 800, treasuryShareOfGold: 0.2, traits: ['orderly', 'mercantile'],
    },
};

const NESTED = ['lean', 'civilWar', 'crisis', 'ruling', 'founding', 'officeClaims'];
const POLICY_AXES = ['tax', 'stance', 'faith'];
const FALLBACK_POLICIES = {
    tax: { label: 'Royal taxes', default: 'standard', options: { standard: { label: 'Standard', levy: 0.15, mods: {} } } },
    stance: { label: 'War stance', default: 'defensive', options: { defensive: { label: 'Defensive', mods: {} } } },
    faith: { label: 'Faith', default: 'devout', options: { devout: { label: 'Devout', mods: {} } } },
};
const HISTORY_CAP = 40;
const CLAIM_SOURCES = ['marriage', 'forged', 'office', 'conquest', 'purchased'];

/** Deterministic noise in [-1, 1] from a string (no RNG draws). */
function _noise(key) {
    let h = 2166136261;
    const s = String(key);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 2001) / 1000 - 1;
}

const _rep = (player, kid) => (player && player.reputation && player.reputation[kid]) || 0;
const _addRep = (player, kid, v) => {
    if (!player.reputation) player.reputation = {};
    player.reputation[kid] = Utils.clamp((player.reputation[kid] || 0) + v, -100, 100);
};

export const Throne = {

    POLICY_AXES,

    // ── Data ────────────────────────────────────────────────────

    data() {
        return DataLoader.throne || (DataLoader.get && DataLoader.get('throne')) || {};
    },

    config() {
        const over = Throne.data().config || {};
        const cfg = { ...DEFAULT_CONFIG, ...over };
        for (const k of NESTED) cfg[k] = { ...DEFAULT_CONFIG[k], ...(over[k] || {}) };
        return cfg;
    },

    policies() {
        return Throne.data().policies || FALLBACK_POLICIES;
    },

    sourceInfo(id) {
        const s = (Throne.data().sources || {})[id];
        return s || { label: id, icon: '📜' };
    },

    strengthLabel(strength) {
        const labels = Throne.data().strengthLabels || [{ min: 0, label: 'Claim', color: '#aaa' }];
        return labels.find(l => strength >= l.min) || labels[labels.length - 1];
    },

    // ── State ───────────────────────────────────────────────────

    _blank() {
        return { claims: {}, crises: [], civilWar: null, ruling: null, exile: {}, successionSeen: {}, history: [], nextCrisisId: 1 };
    },

    /** The player's throne state, created/backfilled on first use (old saves). */
    state(player) {
        if (!player) return Throne._blank();
        if (!player.throne || typeof player.throne !== 'object') player.throne = Throne._blank();
        const st = player.throne;
        const blank = Throne._blank();
        for (const k of ['claims', 'exile', 'successionSeen']) {
            if (!st[k] || typeof st[k] !== 'object') st[k] = blank[k];
        }
        if (!Array.isArray(st.crises)) st.crises = [];
        if (!Array.isArray(st.history)) st.history = [];
        if (st.civilWar === undefined) st.civilWar = null;
        if (st.ruling === undefined) st.ruling = null;
        if (!(st.nextCrisisId > 0)) st.nextCrisisId = 1;
        return st;
    },

    _log(player, world, text) {
        const st = Throne.state(player);
        st.history.push({ day: (world && world.day) || 0, text });
        if (st.history.length > HISTORY_CAP) st.history = st.history.slice(-HISTORY_CAP);
        if (player.house) House._chronicle(player.house, world, text, ['throne']);
    },

    _kingdom(world, kid) {
        return world && world.getKingdom ? world.getKingdom(kid) : null;
    },

    /** The kingdom the player rules, or null. */
    ruledKingdom(player, world) {
        const r = player && player.throne && player.throne.ruling;
        if (!r) return null;
        const k = Throne._kingdom(world, r.kingdomId);
        return k && k.isAlive ? k : null;
    },

    isExiledFrom(player, world, kid) {
        const until = Throne.state(player).exile[kid];
        return !!until && until > ((world && world.day) || 0);
    },

    // ── Claims ──────────────────────────────────────────────────

    claimStrength(player, kid) {
        const c = Throne.state(player).claims[kid];
        if (!c) return 0;
        const total = CLAIM_SOURCES.reduce((s, src) => s + (c.sources[src] || 0), 0);
        return Math.min(Throne.config().maxClaimStrength, Math.round(total));
    },

    /** [{ kingdomId, kingdom, strength, label, sources: [{ id, value, label, icon }] }] */
    claims(player, world) {
        const out = [];
        for (const c of Object.values(Throne.state(player).claims)) {
            const kingdom = Throne._kingdom(world, c.kingdomId);
            if (!kingdom) continue;
            const strength = Throne.claimStrength(player, c.kingdomId);
            out.push({
                kingdomId: c.kingdomId, kingdom, strength, label: Throne.strengthLabel(strength),
                sources: CLAIM_SOURCES.filter(s => c.sources[s] > 0).map(s => ({ id: s, value: Math.round(c.sources[s]), ...Throne.sourceInfo(s) })),
            });
        }
        return out.sort((a, b) => b.strength - a.strength);
    },

    /**
     * Add to one source of a claim. mode 'max' keeps the larger value (marriage,
     * office, conquest); 'add' stacks up to cap (forgeries, heralds).
     * Returns the new claim strength, or 0 if no claim can be held.
     */
    grantClaim(player, world, kid, source, amount, { mode = 'max', cap = Infinity } = {}) {
        const kingdom = Throne._kingdom(world, kid);
        if (!player || !kingdom || !kingdom.isAlive) return 0;
        const st = Throne.state(player);
        if (st.ruling && st.ruling.kingdomId === kid) return 0;
        if (!st.claims[kid]) st.claims[kid] = { kingdomId: kid, sources: {}, gainedDay: (world && world.day) || 0 };
        const src = st.claims[kid].sources;
        const before = src[source] || 0;
        src[source] = mode === 'add' ? Math.min(cap, before + amount) : Math.max(before, amount);
        if (src[source] > before) {
            Throne._log(player, world, `${Throne.sourceInfo(source).icon} A claim on the throne of ${kingdom.name} (${Throne.sourceInfo(source).label}, now ${Throne.claimStrength(player, kid)}).`);
        }
        return Throne.claimStrength(player, kid);
    },

    /** PlayerMilitary.attackSettlement calls this when the player storms a capital. */
    onCapitalCaptured(player, world, kid) {
        const k = Throne._kingdom(world, kid);
        if (!k || !k.isAlive) return 0;
        return Throne.grantClaim(player, world, kid, 'conquest', Throne.config().conquestStrength);
    },

    /** Living kingdoms the player could hold a claim on (not their own crown). */
    claimableKingdoms(player, world) {
        const st = Throne.state(player);
        return (world.kingdoms || []).filter(k => k.isAlive && !(st.ruling && st.ruling.kingdomId === k.id));
    },

    // ── Royal marriage ──────────────────────────────────────────

    /** Unmarried adult princes and princesses of a kingdom's ruling dynasty. */
    royalMatchCandidates(world, kid) {
        const k = Throne._kingdom(world, kid);
        const data = k && k.characterData;
        if (!data || !Array.isArray(data.children)) return [];
        return data.children.filter(c => c && c.isAlive && c.age >= 16 && !c.spouseId)
            .sort((a, b) => b.age - a.age);
    },

    /** The royal NPC the player is betrothed or married to, if any. */
    royalSpouse(player) {
        const npc = player && player.spouse ? Relationships.getNPC(player.spouse) : null;
        return npc && npc.royal ? npc : null;
    },

    /**
     * Arrange a match with a royal of this kingdom: pay Prestige and a dowry,
     * and they join those you can court (fond of you already) at the capital.
     * Marrying them grants a claim on the throne.
     */
    arrangeRoyalMatch(player, world, kid) {
        const cfg = Throne.config();
        const k = Throne._kingdom(world, kid);
        if (!k || !k.isAlive) return { success: false, reason: 'No such kingdom.' };
        if (player.spouse) return { success: false, reason: 'You are already married.' };
        if (Throne.ruledKingdom(player, world) && Throne.ruledKingdom(player, world).id === kid) return { success: false, reason: 'You already rule this realm.' };
        if (_rep(player, kid) < cfg.royalMatchMinReputation) return { success: false, reason: `${k.name} will not wed its blood to a stranger (need ${cfg.royalMatchMinReputation} reputation).` };
        const royal = Throne.royalMatchCandidates(world, kid)[0];
        if (!royal) return { success: false, reason: `${k.name} has no unwed prince or princess of age.` };
        const capTile = k.capital ? world.getTile(k.capital.q, k.capital.r) : null;
        if (!capTile || !capTile.settlement) return { success: false, reason: `${k.name} has no court to hold the betrothal.` };
        if ((player.gold || 0) < cfg.royalMatchGold) return { success: false, reason: `The dowry is ${cfg.royalMatchGold} gold.` };
        if (!House.spend(player.house, cfg.royalMatchPrestige, `royal match in ${k.name}`, world.day)) {
            return { success: false, reason: `Need ${cfg.royalMatchPrestige} Prestige.` };
        }
        player.gold -= cfg.royalMatchGold;

        const npc = Relationships.generateNPC({ ...capTile.settlement, q: capTile.q, r: capTile.r }, world);
        npc.firstName = royal.firstName;
        npc.dynasty = royal.dynasty;
        npc.gender = royal.gender;
        npc.age = royal.age;
        npc.culture = royal.culture || k.culture;
        npc.occupation = 'noble';
        npc.noble = true;
        npc.royal = { kingdomId: kid, charId: royal.id, dynasty: royal.dynasty };
        npc.attraction = Math.max(npc.attraction || 0, 95);
        npc.metDay = world.day;
        const rel = Relationships.getRelationship(player, npc.id);
        rel.affection = Math.max(rel.affection || 0, 70);
        rel.score = Math.max(rel.score || 0, 40);
        royal.spouseId = 'player'; // promised — the crown won't marry them elsewhere
        Throne._log(player, world, `💍 ${npc.firstName} ${npc.dynasty} of the royal house of ${k.name} is promised to ${player.house ? player.house.name : 'you'}.`);
        return {
            success: true, npc,
            message: `${npc.firstName} ${npc.dynasty}, of the blood royal of ${k.name}, awaits you at ${capTile.settlement.name}. Court and wed them there to gain a claim on the throne.`,
        };
    },

    // ── Forged documents & heralds ──────────────────────────────

    _idleSpy(player) {
        const spies = (player.espionage && player.espionage.spies) || [];
        return spies.filter(s => s && s.status === 'idle').sort((a, b) => (b.level || 1) - (a.level || 1))[0] || null;
    },

    forgeChance(player) {
        const cfg = Throne.config();
        const spy = Throne._idleSpy(player);
        if (!spy) return 0;
        const stealth = (player.skills && player.skills.stealth) || 0;
        return Utils.clamp(cfg.forgeBase + cfg.forgePerSpyLevel * ((spy.level || 1) - 1) + cfg.forgePerStealth * stealth, 0.05, 0.9);
    },

    /** An idle spy forges genealogies and charters. Success adds to the claim; failure is noticed. */
    forgeClaim(player, world, kid) {
        const cfg = Throne.config();
        const k = Throne._kingdom(world, kid);
        if (!k || !k.isAlive) return { success: false, reason: 'No such kingdom.' };
        if (Throne.isExiledFrom(player, world, kid)) return { success: false, reason: `You are exiled from ${k.name}.` };
        const spy = Throne._idleSpy(player);
        if (!spy) return { success: false, reason: 'You need an idle spy to forge the documents.' };
        const c = Throne.state(player).claims[kid];
        if (c && (c.sources.forged || 0) >= cfg.forgeCap) return { success: false, reason: 'No archive would believe another forgery.' };
        if ((player.gold || 0) < cfg.forgeGold) return { success: false, reason: `The scribes and seals cost ${cfg.forgeGold} gold.` };
        player.gold -= cfg.forgeGold;
        const chance = Throne.forgeChance(player);
        if (Utils.random() < chance) {
            const strength = Throne.grantClaim(player, world, kid, 'forged', cfg.forgeStrength, { mode: 'add', cap: cfg.forgeCap });
            return { success: true, message: `${spy.name || 'Your spy'} slips forged charters into the royal archives of ${k.name}. Claim strength ${strength}.` };
        }
        _addRep(player, kid, cfg.forgeFailReputation);
        spy.loyalty = Math.max(0, (spy.loyalty || 50) + cfg.forgeFailSpyLoyalty);
        House.accrueRivalFeud(player, world, kid, 5, 'forged claims');
        return { success: true, failed: true, message: `The forgery is exposed. ${k.name} is outraged (${cfg.forgeFailReputation} reputation) and ${spy.name || 'your spy'} is shaken.` };
    },

    /** Spend Prestige on heralds and genealogists who find a link to the blood royal. */
    purchaseClaim(player, world, kid) {
        const cfg = Throne.config();
        const k = Throne._kingdom(world, kid);
        if (!k || !k.isAlive) return { success: false, reason: 'No such kingdom.' };
        if (Throne.isExiledFrom(player, world, kid)) return { success: false, reason: `You are exiled from ${k.name}.` };
        const c = Throne.state(player).claims[kid];
        if (c && (c.sources.purchased || 0) >= cfg.purchaseCap) return { success: false, reason: 'The heralds have found every link there is.' };
        if (!House.spend(player.house, cfg.purchasePrestige, `heralds' claim on ${k.name}`, world.day)) {
            return { success: false, reason: `Need ${cfg.purchasePrestige} Prestige.` };
        }
        const strength = Throne.grantClaim(player, world, kid, 'purchased', cfg.purchaseStrength, { mode: 'add', cap: cfg.purchaseCap });
        return { success: true, message: `Your heralds trace ${player.house ? player.house.name : 'your line'} to the royal blood of ${k.name}. Claim strength ${strength}.` };
    },

    /** Daily: claims from a royal marriage and from a royal office held long enough. */
    _updateClaims(player, world) {
        const cfg = Throne.config();
        const spouse = Throne.royalSpouse(player);
        if (spouse && spouse.isMarried) {
            const children = (player.children || []).length;
            const value = cfg.marriageBase + Math.min(cfg.marriageChildCap, children * cfg.marriagePerChild);
            Throne.grantClaim(player, world, spouse.royal.kingdomId, 'marriage', value);
            const k = Throne._kingdom(world, spouse.royal.kingdomId);
            const royal = k && k.characterData && (k.characterData.children || []).find(c => c.id === spouse.royal.charId);
            if (royal) royal.spouseId = 'player';
        }
        if (player.currentTitle && player.allegiance) {
            const def = Titles.getActiveTitle(player);
            const rule = def && cfg.officeClaims[def.rank];
            const held = (world.day || 0) - (player.titleAppointedDay || 0);
            if (rule && held >= rule.days) Throne.grantClaim(player, world, player.allegiance, 'office', rule.strength);
        }
        // Claims on fallen realms lapse
        const st = Throne.state(player);
        for (const kid of Object.keys(st.claims)) {
            const k = Throne._kingdom(world, kid);
            if (!k || !k.isAlive) delete st.claims[kid];
        }
    },

    // ── Appeal & sides ──────────────────────────────────────────

    /** How strongly the realm's people and lords lean toward the player as ruler (signed). */
    appeal(player, world, kingdom, opts = {}) {
        const L = Throne.config().lean;
        const parts = [];
        const add = (label, v) => { v = Math.round(v * 10) / 10; if (Math.abs(v) >= 0.5) parts.push({ label, value: Math.round(v) }); return v; };
        let a = 0;
        a += add('Claim', Throne.claimStrength(player, kingdom.id) * L.claimWeight);
        a += add('Reputation', Utils.clamp(opts.reputation != null ? opts.reputation : _rep(player, kingdom.id), -100, 100) * L.reputationWeight);
        a += add('Prestige', Math.min(L.prestigeCap, House.getPrestige(player) / L.prestigePer));
        a += add('The court\'s opinion', Utils.clamp(NPCLords.getLordOpinion(kingdom.lord, player) * L.opinionWeight, -L.opinionCap, L.opinionCap));
        // Flat trait opinion plus the king's own affinities (a Pious king likes a Pious pretender)
        a += add('Your traits', Utils.clamp(Traits.lordOpinion(player, kingdom.lord), -L.traitCap, L.traitCap));
        const stability = typeof kingdom.stability === 'number' ? kingdom.stability : 60;
        a += add('Unrest in the realm', (L.stabilityPivot - stability) * L.stabilityWeight);
        if (Throne.crisisFor(player, kingdom.id)) a += add('Succession crisis', L.crisisBonus);
        a += add('Your army', Math.min(L.armyCap, (opts.armyStrength || 0) / L.armyPer));
        a += add('Loyalty to the crown', -L.crownLoyalty);
        return { value: Math.round(a), parts };
    },

    _settlementsOf(world, kingdom) {
        const out = [];
        for (const s of (world.getAllSettlements ? world.getAllSettlements() : [])) {
            if (s.kingdom !== kingdom.id) continue;
            const tile = world.getTile(s.q, s.r);
            if (tile && tile.settlement) out.push({ q: s.q, r: s.r, tile, settlement: tile.settlement });
        }
        return out;
    },

    _holdsPropertyAt(player, q, r) {
        return (player.properties || []).some(p => p.q === q && p.r === r)
            || (player.houses || []).some(h => h && h.q === q && h.r === r);
    },

    /**
     * How each settlement and great lord would choose if the banners were
     * raised now. Deterministic (no RNG): appeal plus a fixed local temper.
     */
    forecast(player, world, kid, opts = {}) {
        const L = Throne.config().lean;
        const kingdom = Throne._kingdom(world, kid);
        if (!kingdom) return null;
        const appeal = Throne.appeal(player, world, kingdom, opts);
        const cap = kingdom.capital;
        const settlements = Throne._settlementsOf(world, kingdom).map(e => {
            const isCapital = !!cap && cap.q === e.q && cap.r === e.r;
            const d = cap ? Hex.wrappingDistance(e.q, e.r, cap.q, cap.r, world.width) : 0;
            let lean = appeal.value + _noise(`${kid}:${e.settlement.name}:${e.q},${e.r}`) * L.settlementNoise
                + Math.min(L.distanceCap, d * L.distancePer)
                + (Throne._holdsPropertyAt(player, e.q, e.r) ? L.holdingBonus : 0)
                - (isCapital ? L.capitalPenalty : 0);
            lean = Math.round(lean);
            return {
                key: `${e.q},${e.r}`, q: e.q, r: e.r, name: e.settlement.name, type: e.settlement.type,
                population: e.settlement.population || 0, isCapital, lean,
                // The court holds the capital: it falls last, never at the outset
                side: lean > 0 && !isCapital ? 'pretender' : 'loyalist', wavering: !isCapital && Math.abs(lean) < L.waver,
            };
        });
        const advisors = Object.entries((kingdom.characterData && kingdom.characterData.advisors) || {})
            .filter(([, a]) => a && a.isAlive !== false)
            .map(([role, a]) => {
                const lean = Math.round(appeal.value + _noise(`${kid}:${a.id}`) * L.advisorNoise
                    - ((a.loyalty != null ? a.loyalty : 60) - 50) * L.advisorLoyaltyWeight);
                const roleDef = Characters.ADVISOR_ROLES && Characters.ADVISOR_ROLES[role];
                return {
                    role, roleName: (roleDef && roleDef.name) || role, name: Characters.getFullName(a), lean,
                    side: lean > 0 ? 'pretender' : 'loyalist', wavering: Math.abs(lean) < L.waver,
                };
            });
        const totalPop = settlements.reduce((s, x) => s + x.population, 0) || 1;
        const rebelPop = settlements.filter(x => x.side === 'pretender').reduce((s, x) => s + x.population, 0);
        return { kingdom, appeal, settlements, advisors, rebelShare: rebelPop / totalPop };
    },

    // ── Succession crises ───────────────────────────────────────

    crisisFor(player, kid) {
        return Throne.state(player).crises.find(c => c.kingdomId === kid) || null;
    },

    _crisisCause(succ, cfg) {
        if (succ.crisis) return 'disputed';
        if (succ.type === 'regent') return 'regent';
        if (succ.type === 'distant_relative') return 'distant_relative';
        if (succ.type === 'heir' && (succ.heirAge || 99) < cfg.crisis.youngHeirAge) return 'young_heir';
        return 'heir';
    },

    _crisisText(cause, kingdom, incumbent) {
        const def = (Throne.data().crisisCauses || {})[cause] || { label: 'Succession crisis', text: '{kingdom} is torn between claimants.' };
        return {
            label: def.label,
            text: def.text.replace('{kingdom}', kingdom.name).replace('{incumbent}', incumbent),
        };
    },

    /** Start a crisis in a kingdom whose ruler just died (also used by tests/events). */
    startCrisis(player, world, kingdom, cause, incumbentName) {
        const cfg = Throne.config();
        const st = Throne.state(player);
        if (Throne.crisisFor(player, kingdom.id)) return null;
        const data = kingdom.characterData;
        const rival = Characters.generateCharacter({
            culture: kingdom.culture,
            age: Utils.randInt(25, 50),
            dynasty: data && data.dynasty ? data.dynasty.name : undefined,
        });
        rival.kingdomId = kingdom.id;
        const [lo, hi] = cfg.crisis.rivalSupport;
        const text = Throne._crisisText(cause, kingdom, incumbentName);
        const crisis = {
            id: `crisis_${st.nextCrisisId++}`,
            kingdomId: kingdom.id,
            kingdomName: kingdom.name,
            cause,
            causeLabel: text.label,
            text: text.text,
            startDay: world.day,
            endDay: world.day + cfg.crisis.durationDays,
            claimants: [
                { id: 'incumbent', name: incumbentName, support: cfg.crisis.incumbentSupport[cause] || 40, isIncumbent: true },
                { id: 'rival', name: Characters.getFullName(rival), support: Utils.randInt(lo, hi), character: rival },
            ],
            backing: null, // { claimantId, gold, prestige, battles }
        };
        st.crises.push(crisis);
        Throne._log(player, world, `👑 Succession crisis in ${kingdom.name}: ${text.text}`);
        return crisis;
    },

    /** Look for new AI successions (recorded by Characters.handleSuccession) and maybe spark crises. */
    _detectSuccessions(player, world, out) {
        const cfg = Throne.config();
        const st = Throne.state(player);
        for (const k of world.kingdoms || []) {
            const succ = k.lastSuccession;
            if (!k.isAlive || !succ || succ.day <= (st.successionSeen[k.id] || 0)) continue;
            st.successionSeen[k.id] = succ.day;
            if (Throne.ruledKingdom(player, world) === k) continue;
            if (st.civilWar && st.civilWar.kingdomId === k.id) continue;
            const cause = Throne._crisisCause(succ, cfg);
            const stability = typeof k.stability === 'number' ? k.stability : 60;
            const chance = Utils.clamp((cfg.crisis.chance[cause] || 0) * (1 + (50 - stability) / 100), 0, 1);
            if (Utils.random() < chance) {
                const c = Throne.startCrisis(player, world, k, cause, succ.heirName || k.ruler);
                if (c) out.crises.push(c);
            }
        }
    },

    /**
     * Back a claimant in a crisis. kind: 'gold' (opts.amount), 'prestige', or
     * 'battle' (opts.victory — the caller fought PlayerMilitary.combat).
     */
    backClaimant(player, world, crisisId, claimantId, kind, opts = {}) {
        const C = Throne.config().crisis;
        const crisis = Throne.state(player).crises.find(c => c.id === crisisId);
        if (!crisis) return { success: false, reason: 'That crisis is over.' };
        const claimant = crisis.claimants.find(c => c.id === claimantId);
        if (!claimant) return { success: false, reason: 'No such claimant.' };
        if (crisis.backing && crisis.backing.claimantId !== claimantId) {
            return { success: false, reason: 'You have already chosen a side in this crisis.' };
        }
        const b = crisis.backing || { claimantId, gold: 0, prestige: 0, battles: 0 };
        let gain = 0;
        if (kind === 'gold') {
            const amount = Math.floor(opts.amount || 0);
            if (amount < C.minGold) return { success: false, reason: `Backing a claimant takes at least ${C.minGold} gold.` };
            if ((player.gold || 0) < amount) return { success: false, reason: `You don't have ${amount} gold.` };
            player.gold -= amount;
            b.gold += amount;
            gain = Math.floor(amount / C.goldPerSupport);
        } else if (kind === 'prestige') {
            if (!House.spend(player.house, C.prestigeCost, `backing ${claimant.name}`, world.day)) {
                return { success: false, reason: `Need ${C.prestigeCost} Prestige.` };
            }
            b.prestige += C.prestigeCost;
            gain = C.prestigeSupport;
        } else if (kind === 'battle') {
            b.battles += 1;
            gain = opts.victory ? C.battleSupport : 0;
        } else {
            return { success: false, reason: 'Unknown kind of backing.' };
        }
        crisis.backing = b;
        claimant.support += gain;
        return {
            success: true, gain,
            message: gain > 0 ? `Support for ${claimant.name} grows (+${gain}).` : `Your blows for ${claimant.name} change little.`,
        };
    },

    /** Replace a kingdom's ruler with a new character (a crisis winner or an heir after abdication). */
    _installRuler(world, kingdom, character) {
        const data = kingdom.characterData;
        if (!data || !character) return;
        if (data.ruler) { data.ruler.isRuler = false; data.ruler.deposed = true; }
        character.isRuler = true;
        character.kingdomId = kingdom.id;
        data.ruler = character;
        data.spouse = null;
        if (data.dynasty) {
            if (!data.dynasty.members.includes(character.id)) data.dynasty.members.push(character.id);
            data.dynasty.bloodline.push(character.id);
        }
        kingdom.ruler = Characters.getDisplayName(character, kingdom);
        if (kingdom.lord) kingdom.lord.name = kingdom.ruler;
    },

    _resolveCrisis(player, world, crisis, out) {
        const C = Throne.config().crisis;
        const kingdom = Throne._kingdom(world, crisis.kingdomId);
        const total = crisis.claimants.reduce((s, c) => s + Math.max(1, c.support), 0);
        let roll = Utils.random() * total;
        let winner = crisis.claimants[0];
        for (const c of crisis.claimants) {
            roll -= Math.max(1, c.support);
            if (roll <= 0) { winner = c; break; }
        }
        if (!winner.isIncumbent && winner.character && kingdom) Throne._installRuler(world, kingdom, winner.character);
        const result = { crisis, winner: winner.name, kingdomName: crisis.kingdomName, backed: null, rewards: null };
        const b = crisis.backing;
        if (b && kingdom) {
            const backed = crisis.claimants.find(c => c.id === b.claimantId);
            result.backed = backed ? backed.name : null;
            if (backed === winner) {
                const gold = Math.round(b.gold * C.rewardGoldMultiplier + C.rewardGold);
                player.gold = (player.gold || 0) + gold;
                _addRep(player, kingdom.id, C.rewardReputation);
                House.award(player.house, C.rewardPrestige, `kingmaker in ${kingdom.name}`, world.day);
                result.rewards = { gold, reputation: C.rewardReputation, prestige: C.rewardPrestige };
                Throne._log(player, world, `👑 ${winner.name} wins the throne of ${kingdom.name} with your backing: +${gold}g, +${C.rewardReputation} reputation, +${C.rewardPrestige} Prestige.`);
            } else {
                _addRep(player, kingdom.id, C.loserReputation);
                result.rewards = { reputation: C.loserReputation };
                Throne._log(player, world, `👑 ${winner.name} wins the throne of ${kingdom.name}; the claimant you backed is cast down (${C.loserReputation} reputation).`);
            }
        } else {
            Throne._log(player, world, `👑 The crisis in ${crisis.kingdomName} ends: ${winner.name} holds the throne.`);
        }
        out.crisesResolved.push(result);
    },

    _tickCrises(player, world, out) {
        const st = Throne.state(player);
        for (const crisis of st.crises.slice()) {
            const k = Throne._kingdom(world, crisis.kingdomId);
            const absorbed = st.civilWar && st.civilWar.kingdomId === crisis.kingdomId;
            if (!k || !k.isAlive || absorbed) { st.crises = st.crises.filter(c => c !== crisis); continue; }
            if (world.day >= crisis.endDay) {
                st.crises = st.crises.filter(c => c !== crisis);
                Throne._resolveCrisis(player, world, crisis, out);
            }
        }
    },

    // ── Pressing a claim: civil war ─────────────────────────────

    /** Whether the player could raise the banners now, with the reason if not. */
    canPress(player, world, kid, opts = {}) {
        const cfg = Throne.config();
        const st = Throne.state(player);
        const k = Throne._kingdom(world, kid);
        if (!k || !k.isAlive) return { ok: false, reason: 'No such kingdom.' };
        if (st.civilWar) return { ok: false, reason: 'You are already fighting for a crown.' };
        if (st.ruling) return { ok: false, reason: 'You already wear a crown.' };
        if (Throne.isExiledFrom(player, world, kid)) return { ok: false, reason: `You are exiled from ${k.name} until day ${st.exile[kid]}.` };
        const strength = Throne.claimStrength(player, kid);
        if (strength < cfg.pressMinStrength) return { ok: false, reason: `Your claim is too weak (${strength}; need ${cfg.pressMinStrength}).` };
        if ((opts.armyStrength || 0) < cfg.pressMinArmy) return { ok: false, reason: `You need an army of at least ${cfg.pressMinArmy} strength to raise your banners.` };
        if ((player.gold || 0) < cfg.pressGold) return { ok: false, reason: `Raising the banners costs ${cfg.pressGold} gold.` };
        return { ok: true };
    },

    /** Raise your banners: the realm splits and civil war begins. opts.armyStrength from PlayerMilitary. */
    pressClaim(player, world, kid, opts = {}) {
        const cfg = Throne.config();
        const W = cfg.civilWar;
        const can = Throne.canPress(player, world, kid, opts);
        if (!can.ok) return { success: false, reason: can.reason };
        const st = Throne.state(player);
        const k = Throne._kingdom(world, kid);
        const fc = Throne.forecast(player, world, kid, opts);
        player.gold -= cfg.pressGold;

        // Oaths to the crown you are fighting are broken
        if (player.allegiance === kid) {
            if (player.currentTitle) Titles.resign(player, world);
            player.allegiance = null;
            player.kingdomTitle = null;
            player.title = `Pretender to ${k.name}`;
        }

        const sides = {};
        for (const s of fc.settlements) sides[s.key] = s.side;
        const advisorSides = {};
        for (const a of fc.advisors) advisorSides[a.role] = a.side;
        const turncoats = fc.advisors.filter(a => a.side === 'pretender').length;
        const levies = Math.round((k.military || 0) * fc.rebelShare * W.levyShare);
        k.military = Math.max(0, (k.military || 0) - levies);

        const crisis = Throne.crisisFor(player, kid);
        st.crises = st.crises.filter(c => c !== crisis);

        st.civilWar = {
            kingdomId: kid,
            kingdomName: k.name,
            startDay: world.day,
            momentum: Math.round((fc.rebelShare - 0.5) * 60) + turncoats * W.advisorMomentum,
            levies,
            levyCap: levies,
            initialShare: fc.rebelShare,
            sides,
            leans: Object.fromEntries(fc.settlements.map(s => [s.key, s.lean])),
            advisorSides,
            battlesWon: 0,
            battlesLost: 0,
            lastWarScore: 0,
            collapseDays: 0,
            duringCrisis: !!crisis,
        };
        const war = RealmWars.declareWar(player, world, k, 'civil war');
        war.civilWar = true;
        st.civilWar.lastWarScore = war.score || 0;
        Throne.syncCrowns(player, world);
        const share = Math.round(fc.rebelShare * 100);
        Throne._log(player, world, `🚩 ${player.name || 'The pretender'} raises the banners against ${k.ruler || 'the crown'} of ${k.name}. ${share}% of the realm and ${turncoats} great lord(s) declare for you.`);
        if (Array.isArray(world.events)) world.events.push({ text: `🚩 Civil war in ${k.name}! ${player.name || 'A pretender'} claims the throne.`, type: 'military', category: 'MILITARY' });
        return {
            success: true, civilWar: st.civilWar,
            message: `Civil war! ${share}% of ${k.name} and ${turncoats} of its great lords rise for you, bringing ${levies} levies.`,
        };
    },

    _rebelShare(world, kingdom, cw) {
        let total = 0;
        let rebel = 0;
        for (const e of Throne._settlementsOf(world, kingdom)) {
            const pop = e.settlement.population || 0;
            total += pop;
            if (cw.sides[`${e.q},${e.r}`] === 'pretender') rebel += pop;
        }
        return total > 0 ? rebel / total : 0;
    },

    /** Swing one settlement toward the winner of a battle. Returns its name or null. */
    _flipOne(world, kingdom, cw, toward) {
        const from = toward === 'pretender' ? 'loyalist' : 'pretender';
        const cap = kingdom.capital;
        const pool = Throne._settlementsOf(world, kingdom)
            .map(e => ({ key: `${e.q},${e.r}`, name: e.settlement.name, isCapital: !!cap && cap.q === e.q && cap.r === e.r }))
            .filter(e => (cw.sides[e.key] || 'loyalist') === from);
        if (!pool.length) return null;
        // The capital falls last
        const nonCapital = pool.filter(e => !e.isCapital);
        const choices = nonCapital.length ? nonCapital : pool;
        const lean = e => cw.leans[e.key] || 0;
        choices.sort((a, b) => toward === 'pretender' ? lean(b) - lean(a) : lean(a) - lean(b));
        const pick = choices[0];
        cw.sides[pick.key] = toward;
        return pick.name;
    },

    /** A vanguard drawn from a realm's army: what one battle against it means. */
    vanguardStrength(kingdom) {
        const W = Throne.config().civilWar;
        return Utils.clamp(Math.floor(((kingdom && kingdom.military) || 0) * W.vanguardShare), W.vanguardMin, W.vanguardMax);
    },

    /** Strength of the loyalist vanguard the player's army meets in one battle. */
    loyalistVanguard(player, world) {
        const cw = Throne.state(player).civilWar;
        const k = cw ? Throne._kingdom(world, cw.kingdomId) : null;
        return k ? Throne.vanguardStrength(k) : 0;
    },

    /** The player fought a loyalist vanguard (UI ran PlayerMilitary.combat). */
    recordThroneBattle(player, world, victory) {
        const W = Throne.config().civilWar;
        const cw = Throne.state(player).civilWar;
        const k = cw ? Throne._kingdom(world, cw.kingdomId) : null;
        if (!cw || !k) return { success: false, reason: 'You are not fighting for a crown.' };
        let flipped = null;
        if (victory) {
            cw.momentum += W.vanguardWin;
            cw.battlesWon++;
            k.military = Math.floor((k.military || 0) * (1 - W.loyalistLoss));
            flipped = Throne._flipOne(world, k, cw, 'pretender');
            House.recordPlayerDeed(player, world, 'battleWon', { reason: `battle for the throne of ${k.name}` });
        } else {
            cw.momentum += W.vanguardLoss;
            cw.battlesLost++;
        }
        return {
            success: true, flipped,
            message: victory
                ? `The loyalist vanguard breaks before you.${flipped ? ` ${flipped} declares for you.` : ''} Momentum ${Math.round(cw.momentum)}.`
                : `The loyalists throw you back. Momentum ${Math.round(cw.momentum)}.`,
            failed: !victory,
        };
    },

    _tickCivilWar(player, world, armyStrength, out) {
        const W = Throne.config().civilWar;
        const st = Throne.state(player);
        const cw = st.civilWar;
        const k = Throne._kingdom(world, cw.kingdomId);
        if (!k || !k.isAlive) {
            st.civilWar = null;
            RealmWars.endWar(player, world, cw.kingdomId, 'the realm fell to another');
            delete st.claims[cw.kingdomId];
            Throne._log(player, world, `🚩 ${cw.kingdomName} falls to a foreign crown, and your war for its throne ends with it.`);
            out.civilWar = { ended: 'fallen', kingdomName: cw.kingdomName };
            return;
        }
        // Levies trickle back toward what the rebel towns can field
        const share = Throne._rebelShare(world, k, cw);
        const cap = cw.levyCap * (cw.initialShare > 0 ? share / cw.initialShare : 0);
        if (cw.levies < cap) cw.levies = Math.round(cw.levies + (cap - cw.levies) * W.levyRegen);

        // A field battle about one day in three
        if (Utils.random() < W.battleChance) {
            const pretender = cw.levies + armyStrength;
            const loyal = (k.military || 0) * W.fieldShare;
            const winP = Utils.clamp(pretender / Math.max(1, pretender + loyal) + cw.momentum / 400, 0.1, 0.9);
            if (Utils.random() < winP) {
                cw.momentum += W.momentumPerBattle;
                k.military = Math.floor((k.military || 0) * (1 - W.loyalistLoss));
                const flipped = Utils.random() < W.flipChance ? Throne._flipOne(world, k, cw, 'pretender') : null;
                out.battles.push({ won: true, flipped });
            } else {
                cw.momentum -= W.momentumPerBattle;
                cw.levies = Math.floor(cw.levies * (1 - W.rebelLoss));
                const flipped = Utils.random() < W.flipChance ? Throne._flipOne(world, k, cw, 'loyalist') : null;
                out.battles.push({ won: false, flipped });
            }
        }
        // The realm drifts toward whoever holds more of it
        const shareNow = Throne._rebelShare(world, k, cw);
        cw.momentum += (shareNow - W.driftPivot) * W.driftWeight;
        // War hosts broken (+) or holdings lost (−) in the RealmWars war
        const war = player.realmWars && player.realmWars.wars && player.realmWars.wars[k.id];
        if (war) {
            cw.momentum += ((war.score || 0) - (cw.lastWarScore || 0)) * W.hostScoreWeight;
            cw.lastWarScore = war.score || 0;
        }
        cw.momentum = Math.round(cw.momentum * 10) / 10;

        // Outcome
        const allTaken = Object.values(cw.sides).length > 0 && Object.values(cw.sides).every(s => s === 'pretender');
        if (cw.momentum >= W.victoryMomentum || allTaken) {
            out.civilWar = { ended: 'crowned', ...Throne._crown(player, world, k, 'conquest') };
            return;
        }
        cw.collapseDays = (cw.levies < 10 && armyStrength < 20) ? (cw.collapseDays || 0) + 1 : 0;
        const days = world.day - cw.startDay;
        if (cw.momentum <= W.defeatMomentum || cw.collapseDays >= W.collapseDays) {
            out.civilWar = { ended: 'exile', ...Throne._exile(player, world, k) };
            return;
        }
        if (days >= W.maxDays) {
            out.civilWar = cw.momentum >= W.lateVictoryMomentum
                ? { ended: 'crowned', ...Throne._crown(player, world, k, 'weariness') }
                : { ended: 'exile', ...Throne._exile(player, world, k) };
        }
    },

    /** Give up the fight: the same as losing it. */
    abandonClaim(player, world) {
        const cw = Throne.state(player).civilWar;
        const k = cw ? Throne._kingdom(world, cw.kingdomId) : null;
        if (!cw || !k) return { success: false, reason: 'You are not fighting for a crown.' };
        const res = Throne._exile(player, world, k);
        return { success: true, failed: true, message: res.message };
    },

    // ── Victory and exile ───────────────────────────────────────

    _playerSkill(player, keys) {
        const sk = player.skills || {};
        const v = Math.max(...keys.map(key => sk[key] || 0));
        return Utils.clamp(Math.round(4 + v * 1.6), 1, 20);
    },

    /** The character standing for the player on the kingdom's throne (no RNG). */
    _playerRuler(player, kingdom) {
        const existing = kingdom.characterData && kingdom.characterData.ruler;
        const ruler = existing && existing.isPlayer ? existing : {
            id: `player_ruler_${kingdom.id}`,
            isPlayer: true, isAlive: true, isRuler: true,
            traits: [], health: 100, isIll: false,
            spouseId: null, childrenIds: [], parentId: null, siblingIds: [],
            maxLifespan: 999, opinions: {}, birthDay: 0,
        };
        const last = (player.house && player.house.name ? player.house.name.replace(/^House\s+/i, '') : '') || player.lastName || '';
        ruler.firstName = player.firstName || player.name || 'Pretender';
        ruler.dynasty = last;
        ruler.gender = player.gender === 'female' ? 'female' : 'male';
        ruler.age = player.age || 30;
        ruler.culture = kingdom.culture;
        ruler.kingdomId = kingdom.id;
        // Never "unwed" to the AI's matchmakers: the player marries through
        // Relationships, not Characters._considerDiplomaticMarriages
        ruler.spouseId = player.spouse || 'player_sovereign';
        ruler.skills = {
            martial: Throne._playerSkill(player, ['combat', 'leadership']),
            diplomacy: Throne._playerSkill(player, ['diplomacy']),
            stewardship: Throne._playerSkill(player, ['commerce']),
            intrigue: Throne._playerSkill(player, ['stealth']),
            learning: Throne._playerSkill(player, ['cartography']),
        };
        return ruler;
    },

    _rulerName(player, kingdom) {
        const r = Throne._playerRuler(player, kingdom);
        return Characters.getDisplayName(r, kingdom);
    },

    /** Seat the player on a kingdom's throne (after a civil war, or founding). */
    _takeThrone(player, world, kingdom, { founded = false } = {}) {
        const st = Throne.state(player);
        const defaults = {};
        for (const axis of POLICY_AXES) defaults[axis] = (Throne.policies()[axis] || FALLBACK_POLICIES[axis]).default;
        if (player.currentTitle) Titles.resign(player, world);
        const ruler = Throne._playerRuler(player, kingdom);
        if (!kingdom.characterData) {
            kingdom.characterData = {
                dynasty: { id: `dyn_${kingdom.id}`, name: ruler.dynasty, culture: kingdom.culture, kingdomId: kingdom.id, foundedDay: world.day, members: [], prestige: 10, bloodline: [] },
                ruler: null, spouse: null, children: [], advisors: Characters.generateAdvisors(kingdom),
            };
        }
        const data = kingdom.characterData;
        if (data.ruler && data.ruler !== ruler) { data.ruler.isRuler = false; data.ruler.deposed = true; }
        data.ruler = ruler;
        data.spouse = null;
        if (data.dynasty) {
            if (!data.dynasty.members.includes(ruler.id)) data.dynasty.members.push(ruler.id);
            data.dynasty.bloodline.push(ruler.id);
        }
        kingdom.ruler = Characters.getDisplayName(ruler, kingdom);
        if (kingdom.lord) kingdom.lord.name = kingdom.ruler;
        st.ruling = { kingdomId: kingdom.id, since: world.day, founded, policies: defaults, levyTotal: 0, peaceCooldown: {} };
        delete st.claims[kingdom.id];
        st.crises = st.crises.filter(c => c.kingdomId !== kingdom.id);
        player.allegiance = kingdom.id;
        player.kingdomTitle = 'king';
        player.title = `${ruler.gender === 'female' ? 'Queen' : 'King'} of ${kingdom.name}`;
        // Every crown won — taken in a civil war or founded — counts for the House's legacy
        if (player.house) {
            player.house.stats = player.house.stats || {};
            player.house.stats.crowned = (player.house.stats.crowned || 0) + 1;
        }
        _addRep(player, kingdom.id, 0);
        player.reputation[kingdom.id] = Math.max(player.reputation[kingdom.id], Throne.config().crownedReputation);
        Throne.syncCrowns(player, world);
    },

    _crown(player, world, kingdom, how) {
        const cfg = Throne.config();
        const st = Throne.state(player);
        const cw = st.civilWar;
        st.civilWar = null;
        // The rebel levies return to the royal host
        if (cw) kingdom.military = (kingdom.military || 0) + Math.round(cw.levies || 0);
        RealmWars.endWar(player, world, kingdom.id, 'the pretender was crowned');
        const truces = player.realmWars && player.realmWars.truces;
        if (truces) delete truces[kingdom.id];
        Throne._takeThrone(player, world, kingdom);
        player.renown = (player.renown || 0) + cfg.crownedRenown;
        House.award(player.house, cfg.crownedPrestige, `crowned in ${kingdom.name}`, world.day);
        const text = how === 'weariness'
            ? `👑 The loyalists of ${kingdom.name} lay down their arms. ${kingdom.ruler} is crowned!`
            : `👑 The civil war is won. ${kingdom.ruler} is crowned in ${kingdom.name}!`;
        Throne._log(player, world, text);
        if (Array.isArray(world.events)) world.events.push({ text, type: 'political', category: 'political', kingdom: kingdom.id });
        return { kingdomName: kingdom.name, message: `${text} +${cfg.crownedPrestige} Prestige, +${cfg.crownedRenown} renown.` };
    },

    _exile(player, world, kingdom) {
        const cfg = Throne.config();
        const st = Throne.state(player);
        const cw = st.civilWar;
        st.civilWar = null;
        // Rebel towns submit; their surviving levies go home to the crown
        if (cw) kingdom.military = (kingdom.military || 0) + Math.round((cw.levies || 0) * 0.5);
        RealmWars.endWar(player, world, kingdom.id, 'the pretender fled into exile');
        delete st.claims[kingdom.id];
        st.exile[kingdom.id] = world.day + cfg.exileDays;
        if (!player.reputation) player.reputation = {};
        player.reputation[kingdom.id] = Math.min(player.reputation[kingdom.id] || 0, cfg.exileReputation);
        if (player.allegiance === kingdom.id) { player.allegiance = null; player.kingdomTitle = null; }
        if (/^Pretender/.test(player.title || '')) player.title = 'Exile';
        const loss = Math.min(House.getPrestige(player), cfg.exilePrestigeLoss);
        if (loss > 0) House.spend(player.house, loss, `exiled from ${kingdom.name}`, world.day);
        const text = `🥀 The pretender's cause in ${kingdom.name} is lost. ${player.name || 'You'} flees into exile; the claim is gone (−${loss} Prestige).`;
        Throne._log(player, world, text);
        if (Array.isArray(world.events)) world.events.push({ text, type: 'political', category: 'political', kingdom: kingdom.id });
        return { kingdomName: kingdom.name, message: text };
    },

    // ── Ruling ──────────────────────────────────────────────────

    /** Combined policy modifiers for a ruled realm (fed to KingdomBonuses via kingdom.crown.mods). */
    policyMods(policies) {
        const mods = {};
        for (const axis of POLICY_AXES) {
            const def = Throne.policies()[axis];
            const opt = def && def.options && def.options[policies[axis]];
            for (const [key, v] of Object.entries((opt && opt.mods) || {})) mods[key] = (mods[key] || 0) + v;
        }
        return mods;
    },

    /** Rebuild kingdom.crown on every kingdom from the player's throne state. */
    syncCrowns(player, world) {
        if (!world || !world.kingdoms) return;
        const cfg = Throne.config();
        const st = Throne.state(player);
        for (const k of world.kingdoms) {
            const crown = { playerRuled: false, mods: {} };
            let touched = false;
            if (st.ruling && st.ruling.kingdomId === k.id) {
                crown.playerRuled = true;
                crown.policies = { ...st.ruling.policies };
                crown.mods = Throne.policyMods(st.ruling.policies);
                // The royal court: council, edicts, vassals and revolts (systems/kingship.js)
                const court = st.ruling.court;
                if (court && court.mods) {
                    for (const [key, v] of Object.entries(court.mods)) crown.mods[key] = (crown.mods[key] || 0) + v;
                }
                if (court && court.revolt) crown.revolt = true;
                touched = true;
            }
            if (st.civilWar && st.civilWar.kingdomId === k.id) {
                crown.civilWar = true;
                crown.mods.stability = (crown.mods.stability || 0) + cfg.civilWar.stabilityMod;
                touched = true;
            }
            if (st.crises.some(c => c.kingdomId === k.id)) {
                crown.crisis = true;
                crown.mods.stability = (crown.mods.stability || 0) + cfg.crisis.stabilityMod;
                touched = true;
            }
            if (touched) k.crown = crown;
            else if (k.crown) delete k.crown;
        }
    },

    setPolicy(player, world, axis, optionId) {
        const k = Throne.ruledKingdom(player, world);
        if (!k) return { success: false, reason: 'You rule no realm.' };
        const def = Throne.policies()[axis];
        const opt = def && def.options && def.options[optionId];
        if (!opt) return { success: false, reason: 'No such policy.' };
        const r = Throne.state(player).ruling;
        if (r.policies[axis] === optionId) return { success: false, reason: 'That is already your policy.' };
        r.policies[axis] = optionId;
        Throne.syncCrowns(player, world);
        return { success: true, message: `${def.label}: ${opt.label}. ${opt.blurb || ''}`.trim() };
    },

    /** Kingdoms the ruled realm could act toward diplomatically. */
    diplomacyTargets(player, world) {
        const k = Throne.ruledKingdom(player, world);
        if (!k) return [];
        return world.kingdoms.filter(o => o.isAlive && o.id !== k.id).map(o => ({
            kingdom: o,
            relations: Math.round((k.relations && k.relations[o.id]) || 0),
            atWar: (k.wars || []).includes(o.id),
            allied: (k.allies || []).includes(o.id),
            truce: KingdomAI.hasTruce(k, o, world),
        }));
    },

    declareRealmWar(player, world, targetId) {
        const k = Throne.ruledKingdom(player, world);
        const t = Throne._kingdom(world, targetId);
        if (!k || !t || !t.isAlive) return { success: false, reason: 'No such realm.' };
        if ((k.wars || []).includes(t.id)) return { success: false, reason: `You are already at war with ${t.name}.` };
        if ((k.allies || []).includes(t.id)) return { success: false, reason: `${t.name} is your ally.` };
        if (KingdomAI.hasTruce(k, t, world)) return { success: false, reason: `A truce with ${t.name} still holds.` };
        KingdomAI.startWar(k, t, world);
        if (Array.isArray(world.events)) world.events.push({ text: `⚔️ ${k.name} has declared war on ${t.name}!`, type: 'military' });
        Throne._log(player, world, `⚔️ By your command, ${k.name} declares war on ${t.name}.`);
        return { success: true, message: `${k.name} marches on ${t.name}.` };
    },

    peaceChance(player, world, enemyId) {
        const R = Throne.config().ruling;
        const k = Throne.ruledKingdom(player, world);
        const e = Throne._kingdom(world, enemyId);
        if (!k || !e) return 0;
        const ratio = (k.military || 0) / Math.max(1, e.military || 0);
        // A Chancellor's envoys (systems/kingship.js) improve the odds
        const court = Throne.state(player).ruling.court;
        const chancellor = (court && court.peaceChance) || 0;
        return Utils.clamp(R.peaceBaseChance + (ratio - 1) * 0.25 + chancellor, 0.1, 0.9);
    },

    proposePeace(player, world, enemyId) {
        const R = Throne.config().ruling;
        const k = Throne.ruledKingdom(player, world);
        const e = Throne._kingdom(world, enemyId);
        if (!k || !e) return { success: false, reason: 'No such realm.' };
        if (!(k.wars || []).includes(e.id)) return { success: false, reason: `You are not at war with ${e.name}.` };
        const r = Throne.state(player).ruling;
        if ((r.peaceCooldown[e.id] || 0) > world.day) return { success: false, reason: `${e.name} will not hear your envoys until day ${r.peaceCooldown[e.id]}.` };
        if (Utils.random() < Throne.peaceChance(player, world, enemyId)) {
            KingdomAI.endWar(k, e, world, { text: `🕊️ ${k.name} and ${e.name} make peace.` });
            Throne._log(player, world, `🕊️ ${k.name} makes peace with ${e.name}.`);
            return { success: true, message: `${e.name} accepts your peace. A truce now holds.` };
        }
        r.peaceCooldown[e.id] = world.day + R.peaceCooldownDays;
        return { success: true, failed: true, message: `${e.name} refuses your envoys.` };
    },

    proposeAlliance(player, world, targetId) {
        const R = Throne.config().ruling;
        const k = Throne.ruledKingdom(player, world);
        const t = Throne._kingdom(world, targetId);
        if (!k || !t || !t.isAlive) return { success: false, reason: 'No such realm.' };
        if ((k.allies || []).includes(t.id)) return { success: false, reason: `${t.name} is already your ally.` };
        if ((k.wars || []).includes(t.id)) return { success: false, reason: `You are at war with ${t.name}.` };
        const rel = Math.min((k.relations && k.relations[t.id]) || 0, (t.relations && t.relations[k.id]) || 0);
        if (rel < R.allianceMinRelations) return { success: false, reason: `${t.name} is not warm enough to ally (relations ${Math.round(rel)}; need ${R.allianceMinRelations}).` };
        k.allies.push(t.id);
        t.allies.push(k.id);
        k.relations[t.id] = Math.max(k.relations[t.id] || 0, 75);
        t.relations[k.id] = Math.max(t.relations[k.id] || 0, 75);
        if (Array.isArray(world.events)) world.events.push({ text: `${k.name} and ${t.name} have formed an alliance!`, type: 'diplomatic' });
        Throne._log(player, world, `🤝 ${k.name} allies with ${t.name}.`);
        return { success: true, message: `${t.name} is now your ally.` };
    },

    sendRoyalGifts(player, world, targetId) {
        const R = Throne.config().ruling;
        const k = Throne.ruledKingdom(player, world);
        const t = Throne._kingdom(world, targetId);
        if (!k || !t || !t.isAlive) return { success: false, reason: 'No such realm.' };
        if ((k.treasury || 0) < R.giftCost) return { success: false, reason: `The royal treasury needs ${R.giftCost} gold for gifts.` };
        k.treasury -= R.giftCost;
        if (!t.relations) t.relations = {};
        t.relations[k.id] = Utils.clamp((t.relations[k.id] || 0) + R.giftRelations, -100, 100);
        k.relations[t.id] = Utils.clamp((k.relations[t.id] || 0) + Math.round(R.giftRelations / 2), -100, 100);
        return { success: true, message: `Gifts from the royal treasury warm ${t.name} toward you (+${R.giftRelations}).` };
    },

    /** Step down: a new ruler of the realm's old dynasty takes the throne. */
    abdicate(player, world) {
        const st = Throne.state(player);
        const k = Throne.ruledKingdom(player, world);
        if (!k) return { success: false, reason: 'You rule no realm.' };
        st.ruling = null;
        const heir = Characters.generateCharacter({
            culture: k.culture, age: Utils.randInt(25, 45),
            dynasty: k.characterData && k.characterData.dynasty ? k.characterData.dynasty.name : undefined,
            isRuler: true,
        });
        Throne._installRuler(world, k, heir);
        player.kingdomTitle = 'citizen';
        player.title = `Citizen of ${k.name}`;
        Throne.syncCrowns(player, world);
        Throne._log(player, world, `👑 ${player.name || 'You'} sets down the crown of ${k.name}. ${k.ruler} rules now.`);
        return { success: true, message: `You abdicate. ${k.ruler} takes the throne of ${k.name}.` };
    },

    /** Today's levy rate from the tax policy. */
    levyRate(player) {
        const r = Throne.state(player).ruling;
        if (!r) return 0;
        const tax = Throne.policies().tax;
        const opt = tax && tax.options && tax.options[r.policies.tax];
        return (opt && opt.levy) || 0;
    },

    _tickRuling(player, world, out) {
        const R = Throne.config().ruling;
        const st = Throne.state(player);
        const r = st.ruling;
        const k = Throne._kingdom(world, r.kingdomId);
        if (!k || !k.isAlive) {
            st.ruling = null;
            if (player.allegiance === r.kingdomId) { player.allegiance = null; player.kingdomTitle = null; player.title = 'Deposed'; }
            const name = k ? k.name : 'your realm';
            Throne._log(player, world, `💀 ${name} has fallen, and your crown with it.`);
            out.ruling = { lost: true, kingdomName: name };
            return;
        }
        // The crown passes with the House: an heir who succeeds keeps the throne
        if (player.allegiance !== k.id || player.kingdomTitle !== 'king') {
            player.allegiance = k.id;
            player.kingdomTitle = 'king';
        }
        const ruler = Throne._playerRuler(player, k);
        if (k.characterData) k.characterData.ruler = ruler;
        k.ruler = Characters.getDisplayName(ruler, k);
        if (k.lord) k.lord.name = k.ruler;
        player.title = `${ruler.gender === 'female' ? 'Queen' : 'King'} of ${k.name}`;

        // The royal levy: a share of what the treasury gained since yesterday
        const treasury = k.treasury || 0;
        const gain = typeof r.lastTreasury === 'number' ? treasury - r.lastTreasury : 0;
        const levy = Math.max(0, Math.min(R.levyCap, Math.floor(Math.max(0, gain) * Throne.levyRate(player)),
            Math.floor(treasury - R.levyReserve)));
        if (levy > 0) {
            k.treasury -= levy;
            player.gold = (player.gold || 0) + levy;
            r.levyTotal = (r.levyTotal || 0) + levy;
            if (player.financeToday && player.financeToday.income) {
                player.financeToday.income.royalLevy = (player.financeToday.income.royalLevy || 0) + levy;
            }
            out.levy = levy;
        }
        r.lastTreasury = k.treasury || 0;
        // A crown that seeks peace sends envoys to end its wars
        if (r.policies.stance === 'peace') {
            for (const eid of (k.wars || []).slice()) {
                const e = Throne._kingdom(world, eid);
                if (e && Utils.random() < R.peaceSeekChance) {
                    KingdomAI.endWar(k, e, world, { text: `🕊️ ${k.name}'s envoys win peace with ${e.name}.` });
                    out.peace.push(e.name);
                }
            }
        }
    },

    // ── Founding a kingdom ──────────────────────────────────────

    /** Settlements the player holds outright (colonies and conquered towns). */
    heldSettlements(player, world) {
        const out = [];
        const seen = new Set();
        const add = (q, r) => {
            const key = `${q},${r}`;
            if (seen.has(key)) return;
            const tile = world.getTile(q, r);
            if (!tile || !tile.settlement) return;
            const listed = (player.colonies || []).some(c => c.q === q && c.r === r);
            if (!listed && !(tile.settlement.colony && tile.settlement.colony.isPlayerColony)) return;
            seen.add(key);
            out.push({ q, r, tile, settlement: tile.settlement });
        };
        for (const c of player.colonies || []) add(c.q, c.r);
        return out;
    },

    foundingStatus(player, world) {
        const F = Throne.config().founding;
        const held = Throne.heldSettlements(player, world);
        const prestige = House.getPrestige(player);
        const reasons = [];
        if (Throne.state(player).ruling) reasons.push('You already wear a crown.');
        if (Throne.state(player).civilWar) reasons.push('You are fighting for another crown.');
        if (held.length < F.minSettlements) reasons.push(`Hold ${F.minSettlements} settlements (you hold ${held.length}).`);
        if (prestige < F.minPrestige) reasons.push(`Reach ${F.minPrestige} Prestige (you have ${prestige}).`);
        return { ok: reasons.length === 0, reasons, held, prestige, cost: F.prestigeCost };
    },

    /**
     * Proclaim a new kingdom from the settlements the player holds. Registers
     * a full kingdom entity (territory, relations, court, faith, fleet) that
     * the simulation treats like any other. opts: { name, seat: {q, r} }.
     */
    foundKingdom(player, world, opts = {}) {
        const F = Throne.config().founding;
        const status = Throne.foundingStatus(player, world);
        if (!status.ok) return { success: false, reason: status.reasons[0] };
        if (!House.spend(player.house, F.prestigeCost, 'founding a kingdom', world.day)) {
            return { success: false, reason: `Need ${F.prestigeCost} Prestige.` };
        }
        const held = status.held;
        const seat = (opts.seat && held.find(s => s.q === opts.seat.q && s.r === opts.seat.r)) || held[0];
        const usedIds = new Set(world.kingdoms.map(k => k.id));
        let idx = 1;
        while (usedIds.has(`player_kingdom_${idx}`)) idx++;
        const kingdomId = `player_kingdom_${idx}`;

        const palette = ['#c0392b', '#1f7a8c', '#8e44ad', '#2c3e50', '#16a085', '#d35400', '#7f8c8d', '#6d4c41', '#3949ab', '#8d6e63'];
        const usedColors = new Set(world.kingdoms.map(k => (k.color || '').toLowerCase()));
        const color = palette.find(c => !usedColors.has(c.toLowerCase())) || `#${Utils.randInt(0, 0xffffff).toString(16).padStart(6, '0')}`;
        const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));

        const previousAllegiance = player.allegiance || null;
        const prevKingdom = previousAllegiance ? Throne._kingdom(world, previousAllegiance) : null;
        const seatOwner = Throne._kingdom(world, seat.settlement.kingdom);
        const culture = seat.settlement.culture || (prevKingdom && prevKingdom.culture) || (seatOwner && seatOwner.culture) || 'Imperial';
        const custom = String(opts.name || '').trim().replace(/\s+/g, ' ');
        const name = custom.length >= 3 ? custom.slice(0, 48) : `Kingdom of ${seat.settlement.name}`;

        const k = Kingdom.create({
            id: kingdomId, name, ruler: player.name || 'the Founder', color,
            colorLight: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.2)`, culture,
            description: 'A realm forged by ambition from frontier settlements.',
            preferredTerrain: ['plains', 'grassland', 'hills'],
            traits: [...F.traits],
        });
        k.createdByPlayer = true;
        k.foundedDay = world.day;
        k.capital = { q: seat.q, r: seat.r };
        k.colonization = { policy: 'coexistence', colonies: [], pioneersActive: 0 };
        k.truces = {};
        k.warState = {};
        k.stability = 60;
        k.lord = null;

        let population = 0;
        const territory = new Set();
        const addTerritory = (q, r) => {
            const t = world.getTile(q, r);
            if (!t || !t.terrain || !t.terrain.passable) return;
            const key = `${q},${r}`;
            if (territory.has(key)) return;
            territory.add(key);
            k.territory.push({ q, r });
        };
        const heldKeys = new Set(held.map(s => `${s.q},${s.r}`));
        for (const entry of held) {
            const prevOwner = entry.tile.kingdom ? Throne._kingdom(world, entry.tile.kingdom) : null;
            if (prevOwner && prevOwner.territory) prevOwner.territory = prevOwner.territory.filter(t => t.q !== entry.q || t.r !== entry.r);
            entry.settlement.kingdom = kingdomId;
            entry.tile.kingdom = kingdomId;
            if (entry.settlement.colony) {
                entry.settlement.colony.motherKingdom = kingdomId;
                k.colonization.colonies.push({ q: entry.q, r: entry.r, name: entry.settlement.name });
            }
            population += entry.settlement.population || 0;
            addTerritory(entry.q, entry.r);
            for (const n of Hex.neighbors(entry.q, entry.r)) {
                const nt = world.getTile(n.q, n.r);
                if (!nt || !nt.terrain || !nt.terrain.passable) continue;
                if (nt.settlement && !heldKeys.has(`${n.q},${n.r}`)) continue;
                if (nt.kingdom && nt.kingdom !== previousAllegiance) continue;
                const owner = nt.kingdom ? Throne._kingdom(world, nt.kingdom) : null;
                if (owner && owner.territory) owner.territory = owner.territory.filter(t => t.q !== n.q || t.r !== n.r);
                nt.kingdom = kingdomId;
                addTerritory(n.q, n.r);
            }
            if (entry === seat) {
                entry.settlement.type = 'capital';
                entry.settlement.level = Math.max(entry.settlement.level || 1, 3);
            }
        }
        k.population = population;
        k.military = Math.max(F.minMilitary, Math.floor(population * F.militaryPerPopulation));
        k.treasury = Math.max(F.treasuryFloor, Math.floor((player.gold || 0) * F.treasuryShareOfGold));

        // The realm's faith: the seat's former crown, or the old liege's
        const faithFrom = (seatOwner && seatOwner.religion) ? seatOwner : prevKingdom;
        if (faithFrom && faithFrom.religion) {
            k.religion = { ...JSON.parse(JSON.stringify(faithFrom.religion)), heresies: [], holySites: [], pilgrimIncome: 0 };
        }

        for (const other of world.kingdoms) {
            if (!other.relations) other.relations = {};
            const toNew = other.id === previousAllegiance ? -35 : Utils.randInt(-10, 10);
            const fromNew = other.id === previousAllegiance ? -45 : Utils.randInt(-8, 12);
            other.relations[kingdomId] = toNew;
            k.relations[other.id] = fromNew;
        }
        world.kingdoms.push(k);
        KingdomNavy.ensure(k);

        Throne._takeThrone(player, world, k, { founded: true });
        if (!player.reputation) player.reputation = {};
        player.reputation[kingdomId] = Math.max(player.reputation[kingdomId] || 0, 25);
        if (previousAllegiance && previousAllegiance !== kingdomId) {
            player.reputation[previousAllegiance] = (player.reputation[previousAllegiance] || 0) - 25;
            player.karma = (player.karma || 0) - 3;
        }
        House.award(player.house, Throne.config().crownedPrestige, `founded ${name}`, world.day);
        const text = `👑 ${player.name || 'A new monarch'} proclaims ${name} from ${held.length} settlements.`;
        Throne._log(player, world, text);
        if (Array.isArray(world.events)) world.events.push({ text, type: 'political', category: 'political', kingdom: kingdomId });
        return {
            success: true, kingdom: k,
            message: `You have founded ${name} and claimed ${held.length} settlements.${prevKingdom ? ` ${prevKingdom.name} resents your secession.` : ''}`,
        };
    },

    // ── Daily ───────────────────────────────────────────────────

    /** Anything for the Claims & Crowns panel to show? */
    hasBusiness(player, world) {
        const st = Throne.state(player);
        return !!(st.ruling || st.civilWar || st.crises.length || Object.keys(st.claims).length);
    },

    /**
     * Advance claims, crises, a civil war and the realm one day. Call after
     * world.advanceDay and RealmWars.processDaily. opts.armyStrength is the
     * player's land army (PlayerMilitary.getArmyStrength).
     * @returns {{ crises, crisesResolved, battles, civilWar, ruling, levy, peace }}
     */
    processDaily(player, world, opts = {}) {
        const out = { crises: [], crisesResolved: [], battles: [], civilWar: null, ruling: null, levy: 0, peace: [] };
        if (!player || !world || !world.kingdoms) return out;
        const st = Throne.state(player);
        for (const [kid, until] of Object.entries(st.exile)) if (until <= world.day) delete st.exile[kid];
        Throne._updateClaims(player, world);
        Throne._detectSuccessions(player, world, out);
        Throne._tickCrises(player, world, out);
        if (st.civilWar) Throne._tickCivilWar(player, world, opts.armyStrength || 0, out);
        if (st.ruling) Throne._tickRuling(player, world, out);
        Throne.syncCrowns(player, world);
        return out;
    },

    // ── Persistence ─────────────────────────────────────────────

    serialize(player) {
        return player && player.throne ? JSON.parse(JSON.stringify(player.throne)) : null;
    },

    /** Restore (or backfill for old saves) and re-link the world. */
    load(player, world) {
        if (!player) return;
        Throne.state(player);
        // Pre-throne saves: a kingdom founded with the old Form Kingdom action
        const st = player.throne;
        if (!st.ruling && world && player.allegiance && player.kingdomTitle === 'king') {
            const k = Throne._kingdom(world, player.allegiance);
            if (k && k.isAlive && k.createdByPlayer) {
                const defaults = {};
                for (const axis of POLICY_AXES) defaults[axis] = (Throne.policies()[axis] || FALLBACK_POLICIES[axis]).default;
                st.ruling = { kingdomId: k.id, since: k.foundedDay || 0, founded: true, policies: defaults, levyTotal: 0, peaceCooldown: {} };
            }
        }
        if (st.ruling) {
            for (const axis of POLICY_AXES) {
                if (!st.ruling.policies) st.ruling.policies = {};
                if (!st.ruling.policies[axis]) st.ruling.policies[axis] = (Throne.policies()[axis] || FALLBACK_POLICIES[axis]).default;
            }
            if (!st.ruling.peaceCooldown) st.ruling.peaceCooldown = {};
        }
        if (world) Throne.syncCrowns(player, world);
    },
};
