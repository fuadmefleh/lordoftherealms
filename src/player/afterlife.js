// ============================================
// AFTERLIFE — what happens when the player dies
// ============================================
// Three ways on (ui/actionMenu/afterlife.js draws them):
//   - an adult heir takes up the mantle (Relationships.succeedAsHeir);
//   - a new life: the player becomes someone else living in the world, a
//     townsperson of a town they knew or a local of one they didn't. The
//     late ruler's House ends and what it held passes to crowns and towns;
//   - the interregnum: the world turns on without the player — kingdoms and
//     their wars, markets, prices and harvests, towns and their folk, the
//     merchants' caravans, fairs, guilds, customs and public works — while
//     the House is held in trust and its children grow up. The player jumps
//     back in when they like, as an heir who has come of age or as someone new.
//
// While waiting, the dead player object is the House's estate in trust:
// `player.interregnum = { since, cause, name }` (saved with the player).
// Nothing of the player's own runs (no ailments, upkeep, letters or quests);
// the world's systems run as they do in ui/game/endDay.js, with no player.
// What is kept on the player object waits with the estate rather than
// running: the banks and their loans (Finance), the Bourse, underwriting, bills,
// the merchant houses and the merchant prince's company, sagas, whispers,
// outlaw lairs, heralds, discoveries, pirates at sea, the throne and
// kingship, the House's sieges and wars, demands and delves. Those systems
// keep their state on the player and settle the days they missed (or not)
// when the next life takes it up; running them on the estate would charge
// a dead ruler's purse, seize its holdings for missed loan payments and
// raise its letters, so WORLD_DAY passes them no player.
// An heirless House (no child of the blood alive at death or in the wait,
// or a new life taken) has its money settled once: its creditors paid in
// their order and the rest to the crown (player/estateSettlement.js). An heir
// who takes up the mantle inherits the finances, debts and all, as they stand.
// Strangers and their stations are tuned in data/afterlife.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Difficulty } from '../core/difficulty.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { CoinCensus } from '../systems/coinCensus.js';
import { MoneySupply } from '../world/moneySupply.js';
import { Plague } from '../systems/plague.js';
import { TownMemory } from '../systems/townMemory.js';
import { TownCrimes } from '../systems/townCrimes.js';
import { Water } from '../systems/water.js';
import { TownEras } from '../world/townEras.js';
import { NpcMemory } from '../systems/npcMemory.js';
import { Illness } from '../systems/illness.js';
import { Relationships } from '../systems/relationships.js';
import { Upbringing } from '../systems/upbringing.js';
import { HeirAgency } from '../systems/heirAgency.js';
import { Betrothals, CrownMatches } from '../systems/betrothals.js';
import { Raising } from '../systems/raising.js';
import { HeirPaths } from '../systems/heirPaths.js';
import { Legacy } from '../systems/legacy.js';
import { Annals } from '../systems/annals.js';
import { House } from '../systems/house.js';
import { Quests } from '../systems/quests.js';
import { Achievements } from '../systems/achievements.js';
import { Technology } from '../systems/technology.js';
import { Titles } from '../systems/titles.js';
import { Councils } from '../systems/councils.js';
import { Estates } from '../world/estates.js';
import { Concessions } from '../systems/concessions.js';
import { Fiscal } from '../systems/fiscal.js';
import { Demands } from '../systems/demands.js';
import { Delves } from '../systems/delves.js';
import { Sagas } from '../systems/sagas.js';
import { Whispers } from '../systems/whispers.js';
import { Couriers } from '../systems/couriers.js';
import { CourierRiders } from '../systems/courierRiders.js';
import { Hospitality } from '../systems/hospitality.js';
import { RiverFlotsam } from '../systems/riverFlotsam.js';
import { RiverDrift } from '../systems/riverDrift.js';
import { RiverNets } from '../systems/riverNets.js';
import { FishTraps } from '../systems/fishTraps.js';
import { RiverLife } from '../systems/riverLife.js';
import { OutlawLairs } from '../systems/outlawLairs.js';
import { Gangs } from '../systems/gangs.js';
import { Lots } from '../systems/lots.js';
import { Graveyards } from '../systems/graveyards.js';
import { NpcTheft } from '../systems/npcTheft.js';
import { Brawls } from '../systems/brawls.js';
import { Discovery } from '../systems/discovery.js';
import { Pirates } from '../systems/pirates.js';
import { RealmWars } from '../systems/realmWars.js';
import { HoldingSieges } from '../systems/holdingSieges.js';
import { Throne } from '../systems/throne.js';
import { Kingship } from '../systems/kingship.js';
import { Sieges } from '../systems/sieges.js';
import { MerchantHouses } from '../systems/merchantHouses.js';
import { Stewards } from '../systems/stewards.js';
import { Patronage } from '../systems/patronage.js';
import { Heralds } from '../systems/heralds.js';
import { MerchantCaravans } from '../systems/merchantCaravans.js';
import { MarketFairs } from '../systems/marketFairs.js';
import { Harvests } from '../world/harvests.js';
import { Engrossing } from '../systems/engrossing.js';
import { LawCouncil } from '../systems/lawCouncil.js';
import { Maiming } from '../systems/maiming.js';
import { Executions } from '../systems/executions.js';
import { NamedLegacy } from '../systems/namedLegacy.js';
import { LandMarket } from '../systems/landMarket.js';
import { PuttingOut } from '../systems/puttingOut.js';
import { TradePolicy } from '../systems/tradePolicy.js';
import { PublicWorks } from '../systems/publicWorks.js';
import { GreatWorks } from '../systems/greatWorks.js';
import { Literacy } from '../systems/literacy.js';
import { MarketDynamics } from '../systems/marketDynamics.js';
import { Labour } from '../systems/labour.js';
import { MerchantPrince } from '../systems/merchantPrince.js';
import { Guilds } from '../systems/guilds.js';
import { EconomyChronicle } from '../systems/economyChronicle.js';
import { PriceNews } from '../systems/priceNews.js';
import { Economy } from '../world/economy.js';
import { Finance } from '../systems/finance.js';
import { Underwriting } from '../systems/underwriting.js';
import { Bills } from '../systems/bills.js';
import { Bourse } from '../systems/bourse.js';
import { Mints } from '../systems/mints.js';
import { Coalitions } from '../systems/coalitions.js';
import { EstateSettlement } from './estateSettlement.js';
import { Player } from './player.js';
import { DawnBirth } from './dawnBirth.js';
import { Dawn } from '../world/dawn.js';
import { Characters } from '../world/characters.js';
import { Cultures } from '../world/cultures.js';
import { Languages } from '../systems/languages.js';
import { Crises } from '../systems/crises.js';
import { LastCrisis } from '../systems/lastCrisis.js';
import { RealmDecline } from '../systems/realmDecline.js';
import { PeasantRevolts } from '../systems/peasantRevolts.js';
import { CadetBranches } from '../systems/cadetBranches.js';
import { Abdication } from '../systems/abdication.js';
import { Climate } from '../world/climate.js';
import { RealmTimeline } from '../systems/realmTimeline.js';
import { MaimMarks } from '../systems/maimMarks.js';

const DEFAULTS = {
    candidates: 4,
    minAge: 17,
    maxAge: 42,
    autoPlayMs: 220,
    // The distant years: a wait of at least `minDays` lets the world turn in coarser
    // steps (passDay's opts.distant) — every market and its trade, the labour and the
    // diggings around it once every `marketSpan` days, worked as that many days
    // (SettlementMarket.span); each town's peoples' effects worked out afresh once
    // every `peoplesEvery` days; and once every `realmEvery` days the realms' slow
    // reads — each town's production profile (Economy.calculateProduction), the
    // stability a realm drifts toward (KingdomStability), its recruiting ground
    // (KingdomAI.updateMilitary) — and the crown's arms buyers (RealmArms). The
    // day's output, food, growth, drift, rolls and everything else run daily.
    distant: { minDays: 60, marketSpan: 16, peoplesEvery: 7, realmEvery: 7 },
    roleWeights: { villager: 4, farmer: 3, merchant: 1.4, guard: 1.4, blacksmith_npc: 1, priest: 0.6, noble: 0.35 },
    stations: {
        villager: { title: 'Commoner', gold: [60, 220], stats: { strength: 1 }, skills: {} },
    },
};

/** Station fields a stranger may start with. */
const STAT_KEYS = ['strength', 'charisma', 'intelligence', 'faith', 'luck'];
const SKILL_KEYS = ['commerce', 'combat', 'leadership', 'diplomacy', 'stealth', 'cartography'];

function _obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
function _num(v, d = 0) { return typeof v === 'number' && isFinite(v) ? v : d; }

/**
 * The world's day without the player: every system of ui/game/endDay.js
 * that keeps the world itself turning, given no player. Each step names the
 * system as endDay.js calls it (`sys`); every daily call in endDay.js is
 * either a step here or in WORLD_DAY_SKIPPED with the reason it does not run
 * in the wait — src/__tests__/afterlifeWorldDay.test.js reads endDay.js and
 * fails on a system that is in neither, so a new daily system is classified
 * here when it is added there. The steps marked "waits" keep their state on
 * the player and return at once with none: they stay listed so a world-side
 * half added to one later runs here.
 */
const WORLD_DAY = [
    { sys: 'Townsfolk', run: (w) => Townsfolk.processDay(w, null) },
    // The crowns' promises of their royal children to each other (systems/betrothals.js)
    { sys: 'CrownMatches', run: (w) => CrownMatches.processDay(w) },
    { sys: 'NpcMemory', run: (w) => NpcMemory.processDay(w, null) },
    // (endDay.js runs IllnessPlayer: its towns' half is Illness.processDay)
    { sys: 'IllnessPlayer', run: (w) => Illness.processDay(w, null) },
    { sys: 'Plague', run: (w) => Plague.processDay(w, null) },
    { sys: 'Lots', run: (w) => Lots.processDay(w, null) },
    { sys: 'Graveyards', run: (w) => Graveyards.processDay(w, null) },
    { sys: 'NpcTheft', run: (w) => NpcTheft.processDay(w, null) },
    { sys: 'Brawls', run: (w) => Brawls.processDay(w, null) },
    { sys: 'TownMemory', run: (w) => TownMemory.processDay(w, null) },
    { sys: 'TownCrimes', run: (w) => TownCrimes.processDay(w, null) },
    // The towns' water: foul and dry wells, the sick, the carriers, the leaving (systems/water.js)
    { sys: 'Water', run: (w) => Water.processDay(w, null) },
    { sys: 'TownEras', run: (w) => TownEras.processDay(w, null) },
    { sys: 'Demands', run: (w) => Demands.processDay(w, null) }, // waits (player-held)
    { sys: 'Delves', run: (w) => Delves.processDay(w, null) }, // waits (player-held)
    { sys: 'Sagas', run: (w) => Sagas.processDay(w, null) }, // waits (player-held)
    { sys: 'Whispers', run: (w) => Whispers.processDay(w, null) }, // waits (player-held)
    { sys: 'Couriers', run: (w) => Couriers.processDay(w, null) },
    { sys: 'CourierRiders', run: (w) => CourierRiders.processDay(w, null) },
    { sys: 'Hospitality', run: (w) => Hospitality.processDay(w, null) },
    // The rivers: flotsam comes down, things adrift go on, nets left set fish on (and the
    // bailiff and the poachers find them), floods and the fish (systems/riverFlotsam.js,
    // riverDrift.js, riverNets.js, riverLife.js — the nets lie in the world, not the packs)
    { sys: 'RiverFlotsam', run: (w) => RiverFlotsam.processDay(w, null, _num(w.day)) },
    { sys: 'RiverDrift', run: (w) => RiverDrift.processDay(w, null, _num(w.day) * 24) },
    { sys: 'RiverNets', run: (w) => RiverNets.processDay(w, null, _num(w.day)) },
    { sys: 'FishTraps', run: (w) => FishTraps.processDay(w, null, _num(w.day)) },
    { sys: 'RiverLife', run: (w) => RiverLife.processDay(w, null, _num(w.day)) },
    { sys: 'Gangs', run: (w) => Gangs.processDay(w, null) },
    { sys: 'OutlawLairs', run: (w) => OutlawLairs.processDay(w, null) }, // waits (player-held)
    { sys: 'Discovery', run: (w) => Discovery.processDay(w, null) }, // waits (player-held)
    { sys: 'Pirates', run: (w) => Pirates.processDay(w, null) }, // waits (player-held)
    { sys: 'RealmWars', run: (w) => RealmWars.processDaily(null, w) }, // waits (player-held)
    { sys: 'HoldingSieges', run: (w) => HoldingSieges.processDay(w, null) },
    { sys: 'Throne', run: (w) => Throne.processDaily(null, w, { armyStrength: 0 }) }, // waits (player-held)
    { sys: 'Kingship', run: (w) => Kingship.processDay(w, null) }, // waits (player-held)
    { sys: 'Sieges', run: (w) => Sieges.processDay(w, null) }, // waits (player-held)
    { sys: 'Stewards', run: (w) => Stewards.processDay(w, null) }, // waits (player-held)
    { sys: 'MerchantHouses', run: (w) => MerchantHouses.processDay(null, w) }, // waits (player-held)
    { sys: 'Patronage', run: (w) => Patronage.processDay(w, null) },
    { sys: 'Heralds', run: (w) => Heralds.processDay(w, null) }, // waits (player-held)
    { sys: 'MerchantCaravans', run: (w) => MerchantCaravans.processDay(w, null) },
    { sys: 'MarketFairs', run: (w) => MarketFairs.processDay(w, null) },
    { sys: 'Harvests', run: (w) => Harvests.processDay(w, null) },
    { sys: 'Engrossing', run: (w) => Engrossing.processDay(w, null) },
    { sys: 'LawCouncil', run: (w) => LawCouncil.processDay(w, null) },
    // The realms' courts take thieves' hands, the raided count their maimed (the enemies' blades at the House wait: systems/maiming.js)
    { sys: 'Maiming', run: (w) => Maiming.processDay(w, null) },
    // The realms' capitals hang their condemned, martyrs' shrines draw pilgrims and fade (the House's own list waits: systems/executions.js)
    { sys: 'Executions', run: (w) => Executions.processDay(w, null) },
    // The jurists finish their codes, codes steady their realms, resentful towns take back their names (systems/namedLegacy.js)
    { sys: 'NamedLegacy', run: (w) => NamedLegacy.processDay(w, null) },
    { sys: 'Concessions', run: (w) => Concessions.processDay(w, null) },
    { sys: 'LandMarket', run: (w) => LandMarket.processDay(w, null) },
    { sys: 'PuttingOut', run: (w) => PuttingOut.processDay(w, null) },
    { sys: 'TradePolicy', run: (w) => TradePolicy.processDay(w, null) },
    { sys: 'PublicWorks', run: (w) => PublicWorks.processDay(w, null) },
    // Works of the Ages rise (or fall to ruin) with no one living: the House's pledges wait (systems/greatWorks.js)
    { sys: 'GreatWorks', run: (w) => GreatWorks.processDay(w, null) },
    // The towns' letters reckoned (systems/literacy.js)
    { sys: 'Literacy', run: (w) => Literacy.processDay(w, null) },
    { sys: 'MarketDynamics', run: (w) => MarketDynamics.updatePrices(w, null) },
    // (the columns on the roads, systems/migration.js, run inside Labour)
    { sys: 'Labour', run: (w) => Labour.processDay(w, null) },
    { sys: 'MerchantPrince', run: (w) => MerchantPrince.processDay(null, w) }, // waits (player-held)
    { sys: 'Guilds', run: (w) => Guilds.processDay(w, null) },
    // The markets' news keeps travelling town to town, and the caravans act on it (systems/priceNews.js)
    { sys: 'PriceNews', run: (w) => PriceNews.processDay(w, null) },
    { sys: 'EconomyChronicle', run: (w) => EconomyChronicle.processDay(w, null) },
    { sys: 'Fiscal', run: (w) => Fiscal.processDay(w, null) },
    { sys: 'Finance', run: (w) => Finance.processDay(w, null) }, // waits (player-held)
    { sys: 'Underwriting', run: (w) => Underwriting.processDay(w, null) }, // waits (player-held)
    { sys: 'Bills', run: (w) => Bills.processDay(w, null) }, // waits (player-held)
    { sys: 'Bourse', run: (w) => Bourse.processDay(w, null) }, // waits (player-held)
    { sys: 'Mints', run: (w) => Mints.processDay(w, null) },
    // The climate of centuries: its eras begin and end (world/climate.js)
    { sys: 'Climate', run: (w) => Climate.processDay(w, null) },
    // Age-defining crises: invasions, great plagues, schisms, famines, gold rushes (systems/crises.js)
    { sys: 'Crises', run: (w) => Crises.processDay(w, null) },
    // The last crisis of the age plays on (the reckoning does not gather with no one alive; systems/lastCrisis.js)
    { sys: 'LastCrisis', run: (w) => LastCrisis.processDay(w, null) },
    // Great old realms sag under their own weight; the player's strains wait (systems/realmDecline.js)
    { sys: 'RealmDecline', run: (w) => RealmDecline.processDay(w, null) },
    // The commons rise and the realms meet them by their lords' lights; a rising against the empty throne is the realm's (systems/peasantRevolts.js)
    { sys: 'PeasantRevolts', run: (w) => PeasantRevolts.processDay(w, null) },
    // The Timeline of the Realm keeps recording while no one lives (systems/realmTimeline.js)
    { sys: 'RealmTimeline', run: (w) => RealmTimeline.processDay(w, null) },
    // The House's cadet branches live on while it is held in trust: they keep their
    // state on the estate, so passDay runs them with it (systems/cadetBranches.js)
    { sys: 'CadetBranches', run: (w) => CadetBranches.processDay(null, w) }, // waits (player-held; run on the estate in passDay)
];

/**
 * The daily systems of ui/game/endDay.js that do not run in the wait, and why.
 * "Player-held": its state lives on the player and it returns at once with no
 * player (or would act on the dead ruler's purse, body or name); it settles —
 * or lets go — the days it missed when the next life takes it up.
 */
const WORLD_DAY_SKIPPED = {
    Councils: "the player's own council factions",
    Ailments: "the player's wounds and sickness (the towns' sickness runs: IllnessPlayer → Illness)",
    LegendaryArtifacts: "the player's relics",
    Housing: "the player's houses' upkeep",
    Household: "the player's household: wages, larder, guests",
    Ships: "the player's ships and crews",
    TradeLines: "the player's standing trade lines",
    PlayerWorks: "the player's building works",
    Relationships: "the player's marriage, courtship and own aging (the House's children age in passDay)",
    Upbringing: 'run on the estate in passDay',
    HeirAgency: 'run on the estate in passDay',
    Betrothals: 'run on the estate in passDay (promises keep; no offers in the wait)',
    Raising: 'run on the estate in passDay',
    HeirPaths: 'run on the estate in passDay',
    Abdication: 'run on the estate in passDay (interregnum: no pensions)',
    Regency: "a reigning child's regency: no one reigns in the wait",
    CrownSuccession: 'player-held: the contest for the crown waits with the estate; on the return each year of the empty throne weighs against the heir',
    Heirlooms: "player-held: the House's heirlooms wait with the estate",
    Vanishings: "player-held: the player's companions who never came home",
    PeopleCrimes: "player-held: the player's crimes against people",
    NightStreets: "player-held: the player's night landings and grudges",
    House: "player-held: the House's Prestige and ambitions wait in trust",
    RivalHouses: 'player-held: the rival Houses live on the House record; their retinues wait',
    Schemes: 'player-held: rival schemes against the player',
    Petitions: "player-held: petitions to the player's court",
    Rivals: "player-held: the player's rival adventurers",
    Nemesis: "player-held: the player's nemeses (they watch the succession on return)",
    Wanted: 'player-held: the charge sheet (it dies with the criminal on succession; blood debts cool a generation)',
    Ordeals: "player-held: a kinsman's case, champions wanted and perjury waiting to come out are the player's",
    Trials: 'player-held: the trial awaited, the cases before your court and the lawsuits all wait with the player (a dead defendant is tried by no one)',
    ProfaneCrimes: "player-held: the player's profane crimes",
    KinCrimes: "player-held: the House's crimes against the blood",
    HouseQuests: "player-held: the House's unfinished business",
    NpcChatImpact: "player-held: the player's promises in free talk",
    Hearsay: 'player-held: what folk say of the player (re-attributed on succession: Hearsay.onSuccession)',
    Bonds: "player-held: the player's friendships",
    Devotion: "player-held: the player's vows",
    SoulPact: "player-held: the player's soul pact",
    MapTheft: "player-held: grudges over the player's stolen maps",
    CourtLetters: 'player-held: letters to the player (none are written to a dead ruler)',
    Mail: "player-held: the player's post",
    Livestock: "player-held: the player's beasts",
    AnimalCompanions: "player-held: the player's dog, cat, hawk and horse",
    Crops: "player-held: the player's own fields",
    Commissions: "player-held: the player's hired work",
    Languages: "player-held: the player's tongues and interpreter",
    Parentage: "player-held: a child player's parents' roof",
    BackRooms: "player-held: the player's taverns' back rooms",
    Landings: "player-held: reavers on the player's coastal holdings",
    Coalitions: 'player-held: the league against the House (its ultimatum is extended by the days missed)',
    RivalAgents: "player-held: rival Houses' agents against the House",
    HighCrowns: 'player-held: the far crowns in union and their viceroys (Throne.passCrown hands them back to their old lines)',
    Atrocities: "player-held: the player's infamy and hostages",
    Holdings: "player-held: the player's holdings",
    Annals: 'player-held: the House Annals (the reign was filed in Afterlife.begin)',
    PriceKnowledge: "player-held: the player's price book",
    Tavern: "player-held: the player's informants",
    Espionage: "player-held: the player's spies",
    Gossip: 'player-held: rumours of the player',
    Traits: "player-held: the player's traits",
    Underworld: "player-held: the player's heat and crimes",
    FirstSteps: "player-held: the player's opening guide",
    Reckoning: "player-held: the player's reckoning",
    Interrogation: "player-held: the player's dungeon, and rivals' hold on the player's children",
    Thirst: "player-held: the player's own thirst and waterskins (the towns' water runs: Water)",
};

export const Afterlife = {
    /** The world-day steps' systems (as ui/game/endDay.js names them), and the skipped ones with their reasons (the coverage test reads both). */
    worldDaySystems() { return WORLD_DAY.map(st => st.sys); },
    worldDaySkipped() { return { ...WORLD_DAY_SKIPPED }; },

    config() {
        const src = _obj(DataLoader._gamedata && DataLoader._gamedata.afterlife) || {};
        return {
            ...DEFAULTS, ...src,
            distant: { ...DEFAULTS.distant, ...(_obj(src.distant) || {}) },
            roleWeights: { ...DEFAULTS.roleWeights, ...(_obj(src.roleWeights) || {}) },
            stations: { ...DEFAULTS.stations, ...(_obj(src.stations) || {}) },
        };
    },

    /** Is the player waiting out an interregnum? */
    active(player) {
        return !!(player && player.interregnum);
    },

    // ── The interregnum ─────────────────────────────────

    /**
     * The player chose to let time pass. The late ruler's reign is filed now
     * (so the chronicle dates it to the death, not the return); their
     * soldiers, sellswords and companions go their own ways; travel stops.
     * @returns {{ disbanded: number, companions: number }}
     */
    begin(player, world, cause = null) {
        if (!player || player.interregnum) return { disbanded: 0, companions: 0, estate: null };
        const day = _num(world && world.day);
        // No child of the blood at all: the creditors and the crown take the
        // estate now (player/estateSettlement.js), dated inside the reign
        const estate = EstateSettlement.heirless(player) ? Afterlife.settleEstate(player, world, cause) : null;
        if (player.house && player.house.currentReign) Legacy.closeReign(player, world, { cause });
        const disbanded = (player.army || []).length;
        player.army = [];
        player.mercenaryCompanies = [];
        player.activeContract = null;
        player.commission = null;
        const companions = (player.travelParty || []).length;
        player.travelParty = [];
        player.path = null;
        player.queuedPath = null;
        player.autoChart = null;
        player.travelDestination = null;
        player.isMoving = false;
        player.boardedShip = null;
        player.interregnum = { since: day, cause: cause || 'old age', name: player.name };
        return { disbanded, companions, estate };
    },

    /**
     * Is a wait of `days` long enough for the distant years (config distant.minDays)?
     */
    isDistant(days) {
        const D = Afterlife.config().distant;
        return _num(D.minDays, 0) > 0 && _num(days, 0) >= _num(D.minDays, 0);
    },

    /**
     * One day of the world without the player. The House in trust: its
     * children grow up (Upbringing settles their childhood days by default).
     * opts.distant: a day of the distant years (a long wait, config distant):
     * the markets and the peoples' effects in coarser steps — deterministic,
     * the same seed gives the same years, but not the same as day by day.
     * @returns {{ day, events: object[], cameOfAge: object[] }}
     */
    passDay(world, estate, opts = {}) {
        const out = { day: 0, events: [], cameOfAge: [] };
        if (!world) return out;
        const held = typeof world.holdSettlementScan === 'function';
        if (held) world.holdSettlementScan();
        // (transient: set for this day only, never saved — the systems read it off the world)
        if (opts && opts.distant) world._distant = { ...Afterlife.config().distant };
        try {
            const result = world.advanceDay(null, {});
            if (result && Array.isArray(result.events)) out.events.push(...result.events);
            for (const step of WORLD_DAY) step.run(world);
            if (estate) {
                const Y = Relationships._getHeirSettings().daysPerYear;
                if (Y > 0 && world.day % Y === 0) Relationships.ageChildren(estate, world);
                const up = Upbringing.processDay(estate, world);
                // Children abroad come home, betrothals are kept, embassies end (systems/heirAgency.js)
                HeirAgency.processDay(estate, world);
                // Promises to rival Houses, crowns and lords keep; weddings wait for both to be of age (systems/betrothals.js)
                Betrothals.processDay(estate, world);
                // Tutors paid from the estate, wards at court, coming-of-age summaries (systems/raising.js)
                Raising.processDay(estate, world);
                // Children away on their paths, hostages' terms, wards kept (systems/heirPaths.js)
                HeirPaths.processDay(estate, world);
                // The House's retired rulers grow old in the wait (no pensions run: systems/abdication.js)
                Abdication.processDay(estate, world, { interregnum: true });
                // The cadet branches go on with their lives (nobody to ask or answer them)
                const cadets = CadetBranches.processDay(estate, world, { interregnum: true });
                if (cadets.notices.length) out.events.push(...cadets.notices.map(n => ({ text: n.text, type: 'cadet' })));
                out.cameOfAge.push(...(up.comeOfAge || []));
                // The last of the blood died while the world turned: the estate is settled
                if (!EstateSettlement.settled(estate) && EstateSettlement.heirless(estate)) {
                    out.estate = Afterlife.settleEstate(estate, world, estate.interregnum ? estate.interregnum.cause : null);
                }
            }
        } finally {
            if (world._distant) delete world._distant;
            if (held && world._scanHolds > 0) world.releaseSettlementScan();
        }
        out.day = world.day;
        return out;
    },

    /**
     * The heirless House's money, settled once: the creditors paid in their
     * order, the rest to the crown (player/estateSettlement.js). → the record
     * (the same one on a second call).
     */
    settleEstate(player, world, cause = null) {
        return EstateSettlement.settle(player, world, { cause });
    },

    /** Children of the House who could take up the mantle now. */
    heirsReady(estate) {
        return estate ? Relationships.getEligibleHeirs(estate) : [];
    },

    /** Living children still too young: [{ child, years }] — years until they may play. */
    futureHeirs(estate) {
        if (!estate || !Array.isArray(estate.children)) return [];
        const min = Relationships._getHeirSettings().minAgeToPlay;
        return estate.children
            .filter(c => c.isAlive && _num(c.age) < min && !(c.kin && c.kin.unfit) && !MaimMarks.barsRule(c))
            .map(child => ({ child, years: min - _num(child.age) }))
            .sort((a, b) => a.years - b.years);
    },

    /** Years (in the game's reckoning) since the interregnum began. */
    yearsWaited(player, world) {
        const it = player && player.interregnum;
        if (!it || !world) return 0;
        const Y = Relationships._getHeirSettings().daysPerYear || 120;
        return Math.floor((_num(world.day) - _num(it.since)) / Y);
    },

    /** Cadet branches whose head could take up the mantle, nearest the main line first. */
    cadetsReady(estate) {
        return estate ? CadetBranches.heirLine(estate) : [];
    },

    /** The main line ran dry: a cadet branch's head takes up the mantle after the wait. */
    returnAsCadet(estate, world, branchId, opts = {}) {
        const cause = estate && estate.interregnum ? estate.interregnum.cause : null;
        const res = CadetBranches.succeed(estate, world, branchId, { cause, ...opts });
        if (res.success) {
            delete estate.interregnum;
            estate._isDead = false;
        }
        return res;
    },

    /** Take up the mantle as an heir after the wait (succession as on the death screen). */
    returnAsHeir(estate, world, childId, opts = {}) {
        const cause = estate && estate.interregnum ? estate.interregnum.cause : null;
        const res = Relationships.succeedAsHeir(estate, childId, world, { cause, ...opts });
        if (res.success) {
            delete estate.interregnum;
            estate._isDead = false;
        }
        return res;
    },

    // ── A new life ──────────────────────────────────────

    /**
     * People the player could become: grown townsfolk of the towns with a
     * roster, and locals of the towns without one. Deterministic for a world,
     * day and `reroll` count; draws nothing from the shared RNG.
     * @returns {object[]} [{ key, first, last, gender, age, role, station, title, q, r, town, kingdom, folkId, gold }]
     */
    candidates(world, reroll = 0) {
        const C = Afterlife.config();
        const T = Townsfolk.config();
        if (!world || typeof world.getSettlementViews !== 'function') return [];
        const seed = (world.generationParams && world.generationParams.seed) || 1;
        let s = (Utils.hashStr(`${seed}|afterlife|${_num(world.day)}|${reroll}`) >>> 0) || 1;
        const rng = () => {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
            return s / 4294967296;
        };
        const pick = arr => (arr && arr.length ? arr[Math.floor(rng() * arr.length)] : null);
        // At the Dawn of Man nobody comes from nowhere: a new life is born into a clan
        if (Dawn.isActive(world)) {
            const born = Afterlife._dawnCandidates(world, C, rng, pick);
            if (born.length) return born;
        }
        const towns = world.getSettlementViews()
            .map(v => ({ v, live: world.getTile(v.q, v.r) && world.getTile(v.q, v.r).settlement }))
            .filter(t => t.live && _num(t.live.population) > 0);
        if (!towns.length) return [];
        const weighted = towns.map(t => Math.sqrt(_num(t.live.population, 100)));
        const total = weighted.reduce((a, b) => a + b, 0);
        const pickTown = () => {
            let roll = rng() * total;
            for (let i = 0; i < towns.length; i++) { roll -= weighted[i]; if (roll <= 0) return towns[i]; }
            return towns[towns.length - 1];
        };
        const roleOf = (role) => (C.stations[role] ? role : 'villager');
        const day = _num(world.day);
        const out = [];
        const used = new Set();
        for (let tries = 0; out.length < C.candidates && tries < C.candidates * 12; tries++) {
            const { v, live } = pickTown();
            const kingdom = live.kingdom != null && typeof world.getKingdom === 'function' ? world.getKingdom(live.kingdom) : null;
            const base = { q: v.q, r: v.r, town: live.name, townType: live.type, kingdom: kingdom ? kingdom.name : null };
            let person = null;
            const folk = _obj(live.folk) && Array.isArray(live.folk.people) ? live.folk : null;
            if (folk) {
                const grown = Townsfolk.residents(folk).filter(p => {
                    const a = Townsfolk.age(p, day);
                    return a >= C.minAge && a <= C.maxAge && p.role !== 'child' && !used.has(`${v.q},${v.r}#${p.id}`);
                });
                const p = pick(grown);
                if (p) {
                    used.add(`${v.q},${v.r}#${p.id}`);
                    person = { first: p.first, last: p.last, gender: p.gender, age: Townsfolk.age(p, day), role: roleOf(p.retired || p.role), folkId: p.id };
                }
            }
            if (!person) {
                const gender = rng() < 0.5 ? 'male' : 'female';
                const roles = Object.entries(C.roleWeights).filter(([r, w]) => w > 0 && C.stations[r]);
                const wsum = roles.reduce((a, [, w]) => a + w, 0);
                let roll = rng() * wsum;
                let role = 'villager';
                for (const [r, w] of roles) { roll -= w; if (roll <= 0) { role = r; break; } }
                person = {
                    first: pick(T.names[gender]) || 'Wren',
                    last: pick(T.lastNames) || 'Hayward',
                    gender,
                    age: C.minAge + Math.floor(rng() * (C.maxAge - C.minAge + 1)),
                    role,
                    folkId: null,
                };
            }
            const st = C.stations[person.role] || C.stations.villager;
            const g = Array.isArray(st.gold) ? st.gold : [100, 200];
            out.push({
                key: `${v.q},${v.r}#${person.folkId != null ? person.folkId : `n${out.length}`}`,
                ...person, ...base,
                station: person.role,
                title: st.title || Townsfolk.title(person.role, person.gender),
                gold: Math.round(_num(g[0], 100) + rng() * (_num(g[1], 200) - _num(g[0], 100))),
            });
        }
        return out;
    },

    // ── A new life in a place of one's choosing ─────────

    /**
     * Every place a new life may begin, for the "Choose a settlement" list:
     * the living towns and villages (at the Dawn of Man, the villages clans
     * founded and the clans still wandering). Sorted by realm (the free lands
     * last), then largest first.
     * @returns {object[]} [{ id, q, r, name, type, population, kingdom, kingdomId, capital, culture, language, languageName, folk, clanId? }]
     */
    townChoices(world) {
        if (!world || typeof world.getSettlementViews !== 'function') return [];
        const day = _num(world.day);
        const minAge = Afterlife.config().minAge;
        const dawn = Dawn.isActive(world);
        const out = [];
        for (const v of world.getSettlementViews()) {
            const tile = world.getTile(v.q, v.r);
            const live = tile && tile.settlement;
            if (!live || _num(live.population) <= 0) continue;
            if (dawn && !live.dawnBorn) continue;
            const k = live.kingdom != null && typeof world.getKingdom === 'function' ? world.getKingdom(live.kingdom) : null;
            const culture = Cultures.cultureOf(world, live);
            const lang = Cultures.languageOfCulture(culture);
            const folk = _obj(live.folk) && Array.isArray(live.folk.people) ? live.folk : null;
            out.push({
                id: `${v.q},${v.r}`, q: v.q, r: v.r, name: live.name, type: live.type || 'village',
                population: Math.round(_num(live.population)),
                kingdom: k ? k.name : null, kingdomId: k ? k.id : null,
                capital: !!(k && k.capital && k.capital.q === v.q && k.capital.r === v.r),
                culture, language: lang, languageName: lang ? Cultures.languageName(lang) : null,
                folk: folk ? Townsfolk.residents(folk).filter(p => Townsfolk.age(p, day) >= minAge).length : null,
            });
        }
        if (dawn) {
            for (const u of world.units || []) {
                if (u.type !== 'clan' || u.destroyed) continue;
                const lang = Cultures.languageOfCulture(u.culture);
                out.push({
                    id: `clan:${u.id}`, clanId: u.id, q: u.q, r: u.r, name: u.name, type: 'clan',
                    population: Math.round(_num(u.population)), kingdom: null, kingdomId: null, capital: false,
                    culture: u.culture || null, language: lang, languageName: lang ? Cultures.languageName(lang) : null, folk: null,
                });
            }
        }
        out.sort((a, b) => {
            if (!a.kingdom !== !b.kingdom) return a.kingdom ? -1 : 1;
            if (a.kingdom !== b.kingdom) return String(a.kingdom).localeCompare(String(b.kingdom));
            return b.population - a.population || String(a.name).localeCompare(String(b.name));
        });
        return out;
    },

    /** The townChoices entry at hex (q, r): a settlement, else (at the dawn) a clan camped there. */
    townChoiceAt(world, q, r) {
        const all = Afterlife.townChoices(world);
        return all.find(t => t.clanId == null && t.q === q && t.r === r) || all.find(t => t.q === q && t.r === r) || null;
    },

    /**
     * People the player could become in one chosen place (`at`: a
     * townChoices entry, or { q, r } / { clanId }): grown townsfolk of its
     * own roster first (a roster is seeded for a town never walked through),
     * then locals with its culture's names, and one newcomer arriving from
     * elsewhere with a mother tongue of their own. Same ages, stations and
     * purses as `candidates`; at the Dawn of Man, children born into that
     * clan or village. Deterministic for a world, place, day and `reroll`;
     * draws nothing from the shared RNG.
     * @returns {object[]} as `candidates`, each with `chosen: true`, `culture`,
     *   `native` (mother tongue), `kin` (family in town) and, for the arrival,
     *   `newcomer: { from, culture }`
     */
    candidatesAt(world, at, reroll = 0) {
        if (!world || !at || typeof world.getSettlementViews !== 'function') return [];
        const C = Afterlife.config();
        const seed = (world.generationParams && world.generationParams.seed) || 1;
        const where = at.clanId != null ? `clan:${at.clanId}` : `${at.q},${at.r}`;
        let s = (Utils.hashStr(`${seed}|afterlife-at|${where}|${_num(world.day)}|${reroll}`) >>> 0) || 1;
        const rng = () => {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
            return s / 4294967296;
        };
        const pick = arr => (arr && arr.length ? arr[Math.floor(rng() * arr.length)] : null);

        // At the Dawn of Man: born into the clan or village chosen
        if (Dawn.isActive(world)) {
            const home = Afterlife._dawnHomes(world).find(h => (at.clanId != null
                ? h.clan && h.clan.id === at.clanId
                : !h.clan && h.q === at.q && h.r === at.r));
            if (!home) return [];
            return Afterlife._dawnCandidates(world, C, rng, pick, [home]).map(c => ({
                ...c, chosen: true, culture: home.culture || null, native: Cultures.languageOfCulture(home.culture),
            }));
        }

        // A town that is still there
        const tile = typeof world.getTile === 'function' ? world.getTile(at.q, at.r) : null;
        const live = tile && tile.settlement;
        if (!live || _num(live.population) <= 0) return [];
        const day = _num(world.day);
        const kingdom = live.kingdom != null && typeof world.getKingdom === 'function' ? world.getKingdom(live.kingdom) : null;
        const culture = Cultures.cultureOf(world, live);
        const native = Cultures.languageOfCulture(culture);
        const base = { q: at.q, r: at.r, town: live.name, townType: live.type, kingdom: kingdom ? kingdom.name : null, chosen: true };
        const roleOf = (role) => (C.stations[role] ? role : 'villager');
        const station = (person) => {
            const st = C.stations[person.role] || C.stations.villager;
            const g = Array.isArray(st.gold) ? st.gold : [100, 200];
            return {
                station: person.role,
                title: st.title || Townsfolk.title(person.role, person.gender),
                gold: Math.round(_num(g[0], 100) + rng() * (_num(g[1], 200) - _num(g[0], 100))),
            };
        };
        // Someone not on the roster, named as their people name their own
        const stranger = (folkLike) => {
            const gender = rng() < 0.5 ? 'male' : 'female';
            const roles = Object.entries(C.roleWeights).filter(([r, w]) => w > 0 && C.stations[r]);
            const wsum = roles.reduce((a, [, w]) => a + w, 0);
            let roll = rng() * wsum;
            let role = 'villager';
            for (const [r, w] of roles) { roll -= w; if (roll <= 0) { role = r; break; } }
            return {
                first: pick(Townsfolk._firstNames(folkLike, gender)) || 'Wren',
                last: pick(Townsfolk._lastNames(folkLike)) || 'Hayward',
                gender,
                age: C.minAge + Math.floor(rng() * (C.maxAge - C.minAge + 1)),
                role,
                folkId: null,
            };
        };
        const out = [];
        const names = new Set();
        const push = (person, extra = {}) => {
            names.add(`${person.first} ${person.last}`);
            out.push({
                key: `${at.q},${at.r}#${extra.newcomer ? 'newcomer' : person.folkId != null ? person.folkId : `n${out.length}`}`,
                ...person, ...base, culture, native, kin: null, ...station(person), ...extra,
            });
        };

        // Its own people first: a town never walked through gets its roster now (systems/townsfolk.js)
        let folk = _obj(live.folk) && Array.isArray(live.folk.people) ? live.folk : null;
        if (!folk) folk = Townsfolk.seed(live, world, { q: at.q, r: at.r });
        const grown = folk ? Townsfolk.residents(folk).filter(p => {
            const a = Townsfolk.age(p, day);
            return a >= C.minAge && a <= C.maxAge && p.role !== 'child';
        }) : [];
        for (let i = grown.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [grown[i], grown[j]] = [grown[j], grown[i]];
        }
        for (const p of grown.slice(0, C.candidates)) {
            push({ first: p.first, last: p.last, gender: p.gender, age: Townsfolk.age(p, day), role: roleOf(p.retired || p.role), folkId: p.id },
                { kin: Afterlife._kinLine(folk, p) });
        }
        // ...then locals of its culture, when its roster runs short
        const local = folk || { culture };
        for (let tries = 0; out.length < C.candidates && tries < C.candidates * 6; tries++) {
            const person = stranger(local);
            if (names.has(`${person.first} ${person.last}`)) continue;
            push(person);
        }
        // ...and someone just arriving, from another town (most likely of another tongue)
        if (C.newcomer !== false) {
            const others = world.getSettlementViews()
                .map(v => ({ v, live: world.getTile(v.q, v.r) && world.getTile(v.q, v.r).settlement }))
                .filter(t => t.live && t.live !== live && _num(t.live.population) > 0);
            const foreign = others.filter(t => Cultures.cultureOf(world, t.live) !== culture);
            const from = pick(foreign.length && rng() < 0.75 ? foreign : others);
            const fromCulture = from ? Cultures.cultureOf(world, from.live) : culture;
            push(stranger({ culture: fromCulture }), {
                culture: fromCulture,
                native: Cultures.languageOfCulture(fromCulture) || native,
                newcomer: { from: from ? from.live.name : null, culture: fromCulture },
            });
        }
        return out;
    },

    /** "wed to Mara · 2 children": a townsperson's living family on the roster, or null. */
    _kinLine(folk, p) {
        if (!folk || !p) return null;
        const alive = id => {
            const o = Townsfolk.get(folk, id);
            return o && o.died == null ? o : null;
        };
        const parts = [];
        const sp = p.spouse != null ? alive(p.spouse) : null;
        if (sp) parts.push(`wed to ${sp.first}`);
        const kids = (p.kids || []).map(alive).filter(Boolean);
        if (kids.length) parts.push(kids.length === 1 ? `a ${kids[0].gender === 'female' ? 'daughter' : 'son'}, ${kids[0].first}` : `${kids.length} children`);
        const parents = (p.parents || []).map(alive).filter(Boolean);
        if (parents.length) parts.push(parents.length === 2 ? 'both parents living' : `${Townsfolk.kinWord(parents[0], 'parent')} living`);
        return parts.length ? parts.join(' · ') : null;
    },

    /** Where one may be born at the dawn: the wandering clans, and the villages clans founded. */
    _dawnHomes(world) {
        const homes = [];
        for (const u of world.units || []) {
            if (u.type === 'clan' && !u.destroyed) homes.push({ clan: u, q: u.q, r: u.r, name: u.name, clanName: u.clanName, culture: u.culture });
        }
        for (const v of world.getSettlementViews ? world.getSettlementViews() : []) {
            const live = world.getTile(v.q, v.r) && world.getTile(v.q, v.r).settlement;
            if (!live || !live.dawnBorn || _num(live.population) <= 0) continue;
            homes.push({ village: live, q: v.q, r: v.r, name: live.name, clanName: DawnBirth.villageClanName(live), culture: live.culture,
                kingdom: live.kingdom != null && typeof world.getKingdom === 'function' && world.getKingdom(live.kingdom) ? world.getKingdom(live.kingdom).name : null });
        }
        return homes;
    },

    /**
     * New lives at the dawn: children of the wandering clans, or of the
     * villages clans have founded (dawnBorn), each with the clan's name and a
     * family to come (DawnBirth.apply in becomeStranger). → candidates, as
     * `candidates` returns, with `dawn: { clanId }` or `dawn: { q, r }`.
     * `homes` (from _dawnHomes) narrows where they are born.
     */
    _dawnCandidates(world, C, rng, pick, homes = null) {
        homes = homes ? homes.slice() : Afterlife._dawnHomes(world);
        if (!homes.length) return [];
        for (let i = homes.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [homes[i], homes[j]] = [homes[j], homes[i]];
        }
        const B = DawnBirth.data();
        const jobs = B.occupations && B.occupations.length ? B.occupations : ['Hunter'];
        const st = C.stations.villager || {};
        const g = Array.isArray(st.gold) ? st.gold : [10, 40];
        const out = [];
        for (let i = 0; out.length < C.candidates && i < C.candidates * 4; i++) {
            const h = homes[i < homes.length ? i : Math.floor(rng() * homes.length)];
            const gender = rng() < 0.5 ? 'male' : 'female';
            const names = (Characters.FIRST_NAMES && (Characters.FIRST_NAMES[h.culture || 'Woodland'] || Characters.FIRST_NAMES.Imperial)) || {};
            const first = pick(names[gender]) || pick(Townsfolk.config().names[gender]) || 'Wren';
            if (out.some(c => c.first === first && c.q === h.q && c.r === h.r)) continue;
            out.push({
                key: `${h.q},${h.r}#dawn${out.length}`,
                first, last: `of the ${h.clanName}`, gender,
                age: C.minAge + Math.floor(rng() * (C.maxAge - C.minAge + 1)),
                role: 'villager', station: 'villager', folkId: null,
                title: pick(jobs) || 'Hunter',
                q: h.q, r: h.r, town: h.name, townType: h.clan ? 'clan' : 'village', kingdom: h.kingdom || null,
                gold: Math.round(_num(g[0], 10) + rng() * (_num(g[1], 40) - _num(g[0], 10))),
                dawn: h.clan ? { clanId: h.clan.id } : { q: h.q, r: h.r },
            });
        }
        return out;
    },

    /**
     * Hand the late player's holdings in the world to crowns and towns: their
     * estates escheat to the crown, leases go back, tax farms end, town works
     * and toll works, inns, courier houses and theatres pass to their towns
     * and realms, colonies stand alone, buildings on the map are lost.
     * Anything else still marked as the player's is swept the same way.
     * @returns {{ estates, leases, farms, works, properties, colonies, swept }}
     */
    escheat(old, world) {
        const out = { estates: 0, leases: 0, farms: 0, works: 0, properties: 0, colonies: 0, swept: 0, crown: null };
        if (!world) return out;
        const day = _num(world.day);

        // A crown the House wore goes back to the realm (its old line, else a kinsman)
        if (old && old.throne && old.throne.ruling) out.crown = Throne.passCrown(old, world, 'the line ended');

        // Estates go to the crown of the town's realm (Estates keeps its holders' index true)
        const est = _obj(world.estates);
        if (est && _obj(est.estates)) {
            for (const e of Object.values(est.estates)) {
                if (!e || e.holder !== 'player') continue;
                const town = est.towns && est.towns[e.town];
                const kid = town && town.kid != null ? town.kid : null;
                Estates.setHolder(world, e, kid != null ? `crown:${kid}` : 'crown:free');
                out.estates++;
            }
            if (Array.isArray(est.sales)) est.sales = est.sales.filter(x => x && x.seller !== 'player');
        }
        // Mining and land leases go back to the crown
        const hin = _obj(world.hinterland);
        for (const c of (hin && Array.isArray(hin.concessions) ? hin.concessions : [])) {
            if (c && c.holder === 'player' && c.status === 'active') {
                Concessions.surrender(old, world, c.id);
                out.leases++;
            }
        }
        // Tax farms end today; the crown collects again
        try {
            for (const f of Fiscal.state(world).farms || []) {
                if (f && f.holder === 'player') { f.until = Math.min(_num(f.until, day), day); out.farms++; }
            }
        } catch (e) { /* no fiscal state yet */ }

        // The map: buildings, works and colonies
        for (const row of world.tiles || []) {
            for (const tile of row || []) {
                if (!tile) continue;
                if (tile.playerProperty || (Array.isArray(tile.playerProperties) && tile.playerProperties.length)) {
                    out.properties += Array.isArray(tile.playerProperties) ? tile.playerProperties.length : 1;
                    tile.playerProperty = null;
                    tile.playerProperties = null;
                }
                const s = tile.settlement;
                if (!s) continue;
                const works = s.market && _obj(s.market.works);
                for (const w of works ? Object.values(works) : []) {
                    if (w && w.owner === 'player') { w.owner = 'town'; out.works++; }
                }
                if (s.colony && s.colony.isPlayerColony) { s.colony.isPlayerColony = false; out.colonies++; }
                if (s.taxFarm && s.taxFarm.holder === 'player') s.taxFarm = null;
            }
        }
        // Toll roads, canals and harbours: the realm's now
        const tr = _obj(world.transport);
        for (const w of (tr && Array.isArray(tr.works) ? tr.works : [])) {
            if (!w) continue;
            if (w.owner === 'player') { w.owner = w.kid != null ? w.kid : null; out.works++; }
            if (w.payer === 'player') w.payer = 'crown';
        }
        out.swept = Afterlife._sweep(world);
        return out;
    },

    /**
     * Anything left in the world marked as the player's (an inn, a courier
     * house, a bank, a theatre, a Great Work…): owner → 'npc', holder →
     * 'crown', payer → 'crown'. Records of past deeds (`by`, `winner`, logs)
     * are history and stay.
     */
    _sweep(world) {
        let n = 0;
        const seen = new WeakSet();
        const MAP = { owner: 'npc', holder: 'crown', payer: 'crown' };
        const walk = (o, depth) => {
            if (!o || typeof o !== 'object' || seen.has(o) || depth > 10) return;
            seen.add(o);
            if (Array.isArray(o)) { for (const v of o) walk(v, depth + 1); return; }
            for (const k of Object.keys(o)) {
                const v = o[k];
                if (v === 'player' && MAP[k]) { o[k] = MAP[k]; n++; } else if (v && typeof v === 'object') walk(v, depth + 1);
            }
        };
        // The tiles' terrain is shared and large: only what stands on them
        for (const row of world.tiles || []) {
            for (const tile of row || []) {
                if (!tile) continue;
                for (const k of ['settlement', 'improvement', 'culturalBuilding', 'religiousBuilding', 'infrastructure']) walk(tile[k], 0);
            }
        }
        for (const k of Object.keys(world)) {
            if (k === 'tiles') continue;
            walk(world[k], 0);
        }
        return n;
    },

    /**
     * Become `cand` (from candidates()). The late ruler's House ends (its
     * epitaph is returned), what it held in the world is handed on, and a
     * fresh character starts at the candidate's town with their station's
     * purse and skills. The people of the world carry over (the NPC registry
     * lives on the player), but the new character knows none of them.
     * @returns {{ success, player?, epitaph?, escheat?, reason? }}
     */
    becomeStranger(old, world, cand) {
        if (!world || !cand) return { success: false, reason: 'No one to become.' };
        const C = Afterlife.config();
        const cause = old && old.interregnum ? old.interregnum.cause : null;
        // A town chosen a while ago may have been razed or emptied since (not a wandering clan's camp)
        if (!cand.dawn || cand.dawn.clanId == null) {
            const at = typeof world.getTile === 'function' ? world.getTile(cand.q, cand.r) : null;
            if (!at || !at.settlement || _num(at.settlement.population) <= 0) return { success: false, reason: `${cand.town || 'That town'} is no more.` };
        }

        // The old House: its last reign filed, its epitaph written
        let epitaph = null;
        let annalsPast = [];
        // Its money first (heirs or not, the House ends here): the creditors
        // paid and the rest to the crown, before the crown is passed on and
        // the reign filed, so the Annals tell it (player/estateSettlement.js)
        const estate = old ? Afterlife.settleEstate(old, world, cause) : null;
        if (old) {
            Relationships.prepareForSave(old);
            epitaph = old.house ? Legacy.endDynasty(old, world, cause) : null;
            // The court scribe writes its epitaph, kept with the world's history
            // (systems/llmProse.js; the plain epitaph stands until then — and with the model off)
            if (epitaph) {
                epitaph.proseKey = Annals.epitaphKey(old);
                epitaph.prose = Annals.writeEpitaph(world, old, epitaph);
            }
            // Its Annals close too, and go with the new life as "Before" (systems/annals.js)
            annalsPast = Annals.archive(old, world);
        }
        // The league that stood against the old House disbands with it: its
        // levies, embargo on the crown and members' wars end now, not at the
        // crowns' next weekly turn (systems/coalitions.js)
        if (old && Coalitions.active(old)) {
            Coalitions._end(old, world, 'humbled', 'the House it stood against is no more', null, { endWars: true });
        }
        const escheat = Afterlife.escheat(old, world);

        // The townsperson leaves their town's roster for the road
        const tile = world.getTile(cand.q, cand.r);
        const live = tile && tile.settlement;
        // (their coin is their own purse, then what the household had put by in the town's)
        let ownCoin = 0;
        const wantCoin = Math.max(0, Math.round(_num(cand.gold, 100)));
        if (cand.folkId != null && live && live.folk) {
            const p = Townsfolk.get(live.folk, cand.folkId);
            if (p && typeof p.purse === 'number' && p.purse > 0) {
                ownCoin = Math.min(wantCoin, Math.floor(p.purse));
                p.purse = Math.round((p.purse - ownCoin) * 100) / 100;
            }
            if (p) Townsfolk.exile(live.folk, p, _num(world.day), 'the road');
        }
        if (ownCoin < wantCoin) {
            // (Economy.drawTown: a town with no purse record yet is not counted, and pays as asked)
            const from = live && !live.inKind ? live : Economy.nearestPurse(world, cand.q, cand.r);
            ownCoin += from ? Economy.drawTown(from, wantCoin - ownCoin) : 0;
        }
        if (ownCoin < wantCoin && typeof world.getSettlementViews === 'function') {
            // (a town short of coin: the household's kin in the next towns make up the rest,
            // nearest first, so the purse promised on the choice is the purse they set out with)
            const w = world.width || 0;
            const near = world.getSettlementViews()
                .map(v => { const t = world.getTile(v.q, v.r); return { s: t && t.settlement, d: Hex.wrappingDistance(cand.q, cand.r, v.q, v.r, w) }; })
                .filter(e => e.s && e.s !== live && !e.s.inKind && e.s.economy && e.s.economy.gold > 0)
                .sort((a, b) => a.d - b.d);
            for (const e of near) {
                if (ownCoin >= wantCoin) break;
                ownCoin += Economy.drawTown(e.s, wantCoin - ownCoin);
            }
        }

        // Born at the dawn: no surname yet — DawnBirth.apply gives the clan's (and the House its name)
        const dawnBorn = !!(cand.dawn && Dawn.isActive(world));
        const player = new Player({ firstName: cand.first, lastName: dawnBorn ? '' : cand.last, gender: cand.gender, age: cand.age });
        player.q = cand.q; player.r = cand.r;
        player.prevQ = cand.q; player.prevR = cand.r;
        for (const kingdom of world.kingdoms || []) player.reputation[kingdom.id] = 0;
        player.revealArea(world, 4);
        player.discoverNearbyHolySites(world, 4);

        const st = C.stations[cand.station] || C.stations.villager || {};
        player.gold = Math.max(0, Math.round(ownCoin * 100) / 100);
        player.title = st.title || player.title;
        for (const k of STAT_KEYS) player[k] = _num(player[k], 5) + _num(st.stats && st.stats[k]);
        for (const k of SKILL_KEYS) player.skills[k] = _num(player.skills[k]) + _num(st.skills && st.skills[k]);
        player.inventory = { bread: 10 };
        player.birthDay = _num(world.day) - cand.age * (Relationships._getHeirSettings().daysPerYear || 120);
        player.origin = { station: cand.station, town: cand.town, q: cand.q, r: cand.r, day: _num(world.day), from: old ? old.name : null };
        if (cand.chosen) player.origin.chosen = true;
        if (cand.newcomer) player.origin.cameFrom = cand.newcomer.from || null;
        if (annalsPast.length) player.annalsPast = annalsPast;
        // The game's difficulty and victory goal go on into the new life (core/difficulty.js)
        player.scenario = Difficulty.carry(old, world);

        // The world's people carry over; this character knows none of them yet
        if (old) {
            player._relationshipNpcs = old._relationshipNpcs || [];
            player._relationshipNextId = old._relationshipNextId || 1;
            // The banking houses are the world's, not the late ruler's: they
            // carry on with what the estate paid them (and the crowns' debts to them)
            const of = old.finance;
            if (of && Array.isArray(of.banks) && of.banks.length) {
                const nf = Finance.state(player);
                nf.banks = of.banks;
                nf.nextBankId = of.nextBankId || of.banks.length + 1;
                nf.initialized = true;
            }
            // ...and so are the rival merchant houses and the underwriters' guilds: they
            // trade on, capital and all (released, their coin went to the towns and a new
            // set was raised from them again — and with no company of the new life's own,
            // the houses were never seeded again: decades with no merchant houses)
            const om = old.merchant;
            if (om && Array.isArray(om.rivals) && om.rivals.length) {
                const nm = MerchantHouses.state(player);
                nm.rivals = om.rivals;
                nm.rivalsSeeded = true;
                for (const r of nm.rivals) {
                    if (!r) continue;
                    // (the late ruler's shares and quarrels end with the estate)
                    if (r.shares) r.shares.player = 0;
                    r.rivalry = 0;
                }
            }
            const ou = old.underwriting;
            if (ou && Array.isArray(ou.guilds) && ou.guilds.length) {
                const nu = Underwriting.state(player);
                nu.guilds = ou.guilds;
                nu.nextGuildId = ou.nextGuildId || ou.guilds.length + 1;
                nu.initialized = true;
            }
        }
        if (estate) player.origin.estate = { from: estate.name, paid: Math.round(estate.paid), unpaid: Math.round(estate.unpaid), toCrown: Math.round(estate.toCrown), toTown: Math.round(estate.toTown), line: estate.line };

        // Set up as a new game does (ui/game/gameSetup.js), the world kept as it is
        Quests.initialize(player);
        Achievements.initialize(player);
        Technology.initPlayer(player);
        Relationships.initialize(player);
        // A child of a clan (or of a village a clan founded): a father, a mother,
        // brothers and sisters — before the House, which takes the clan's name
        // (the same order as a dawn start, ui/game/gameSetup.js)
        let birth = null;
        if (dawnBorn) {
            const clan = cand.dawn.clanId != null
                ? (world.units || []).find(u => u.type === 'clan' && !u.destroyed && u.id === cand.dawn.clanId) : null;
            birth = DawnBirth.apply(player, world, clan ? { clan } : { village: { q: cand.dawn.q != null ? cand.dawn.q : cand.q, r: cand.dawn.r != null ? cand.dawn.r : cand.r } });
            if (birth) {
                player.prevQ = player.q;
                player.prevR = player.r;
            } else {
                player.lastName = cand.last;
                player.name = `${player.firstName} ${player.lastName}`.trim();
            }
        }
        // A mother tongue: the clan's or the town's, or a newcomer's own (systems/languages.js)
        Languages.initialize(player, world, { native: cand.native || null });
        // Someone of the town knows their own realm; a newcomer has yet to learn it
        if (!cand.newcomer && live && live.kingdom != null && typeof world.getKingdom === 'function' && world.getKingdom(live.kingdom)) {
            if (!player.kingdomsVisited) player.kingdomsVisited = [];
            if (!player.kingdomsVisited.includes(live.kingdom)) player.kingdomsVisited.push(live.kingdom);
            if (typeof player.learnAboutKingdom === 'function') player.learnAboutKingdom(live.kingdom, 'basics');
        }
        House.initialize(player, world);
        House.seedRivals(player, world);
        player.taxRate = 'moderate';
        Titles.initialize(player);
        Councils.initializePlayer(player);
        player.updateVisibility(world, 4);
        if (old) Afterlife._releaseHolders(old, player, world);
        return { success: true, player, epitaph, escheat, estate, kin: birth ? DawnBirth.kinLine(player) : null };
    },

    /**
     * The purses the late House kept track of that the new life does not — its
     * rival Houses, cadet branches, the rival merchant houses and underwriters it
     * traded against, outlaw lairs' hoards, adventurer rivals, an avenger's purse,
     * coin riding with its letters (systems/coinCensus.js reads them off the
     * player) — would drop out of the world with it. Their coin is spent or left
     * in the town nearest where each one stood (else the late ruler's last place),
     * so it stays in the world. → the coin released
     */
    _releaseHolders(old, player, world) {
        const keep = new Set();
        CoinCensus.each(world, player, (h) => keep.add(h));
        let released = 0;
        CoinCensus.each(world, old, (h, key) => {
            if (keep.has(h)) return;
            const v = Utils.cents(Math.max(0, _num(h[key])));
            h[key] = 0;
            if (!(v > 0)) return;
            const at = h.seat && Number.isFinite(h.seat.q) ? h.seat : Number.isFinite(h.q) ? h : old;
            if (!Economy.payNearest(world, at.q, at.r, v)) MoneySupply.leak(world, -v, 'houseEnded');
            released = Utils.cents(released + v);
        });
        return released;
    },
};
