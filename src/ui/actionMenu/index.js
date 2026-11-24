// ============================================
// ACTION MENU — assembled from ./actionMenu/*.js
// ============================================
import { ActionMenu } from './_ref.js';
import { trackShows } from '../panelRefresh.js';
import { trackFirstStepsPanels } from './counsel.js';
import './core.js';
import './trade.js';
import './haggle.js';
import './barterTable.js';
import './build.js';
import './roadPlan.js';
import './colony.js';
import './founding.js';
import './combat.js';
import './battle.js';
import './choiceScenes.js';
import './treasureScenes.js';
import './streetWatch.js';
import './thiefScenes.js';
import './nightScenes.js';
import './prisonScenes.js';
import './seaScenes.js';
import './blockadeScenes.js';
import './dutyScenes.js';
import './winterScenes.js';
import './jobs.js';
import './gambling.js';
// The Fighting Pit: bouts, the book, fighters, the bear and the birds (systems/pitFights.js)
import './pitFights.js';
import './realm.js';
import './skills.js';
import './social.js';
import './houseShips.js';
import './tradeLines.js';
import './riverLife.js';
// The harbour: harbourmaster, dues, the slip, careening, the fishing fleet, ferries (systems/ports.js)
import './harbour.js';
import './landings.js';
import './titlesEspionage.js';
import './services.js';
import './realmPolitics.js';
import './generalship.js';
import './realmEscort.js';
import './court.js';
import './delves.js';
import './underworld.js';
import './throne.js';
// High Crowns: crowns in personal union, viceroys, the Empire (systems/highCrowns.js)
import './highCrowns.js';
import './royalCourt.js';
import './holdings.js';
import './stewards.js';
import './holdingSieges.js';
import './rivals.js';
import './heirs.js';
import './heirAgency.js';
// Matches & Betrothals: children promised to rival Houses, crowns and lords (systems/betrothals.js)
import './matches.js';
import './raising.js';
import './abdication.js';
// Your Name on the World: law codes, names on the map, the founding tale, the last chapter (systems/namedLegacy.js)
import './namedLegacy.js';
import './afterlife.js';
import './parents.js';
import './sagas.js';
import './whispers.js';
import './letters.js';
import './threats.js';
import './crises.js';
import './lastCrisis.js';
// 🔥 Risings: the commons risen against you, the grievance of your towns (systems/peasantRevolts.js)
import './peasantRevolts.js';
import './nemesis.js';
// Blood Feuds: families, Houses and crowns owing blood; wergild, matches, judgement (systems/bloodFeuds.js)
import './bloodFeuds.js';
// Friends & Bonds: sworn kin, drinking companions, mentors, protégés (systems/bonds.js)
import './bonds.js';
// Your Crimes & Enemies: charge sheets, bounty hunters, blood debts (systems/wanted.js)
import './wanted.js';
// Courts & Lawsuits: your trial, your own court, lawsuits between Houses (player/trials.js)
import './trials.js';
import './lodging.js';
import './townLots.js';
import './peopleCrimes.js';
import './graveyards.js';
import './townCrimes.js';
// Profane crimes: a rival House's crypt, the relic trade (systems/profaneCrimes.js)
import './profane.js';
import './sickness.js';
// Water: thirst, the skins, the town's wells (player/thirst.js, systems/water.js)
import './water.js';
import './livestock.js';
import './furnishing.js';
import './household.js';
import './courierRiders.js';
import './rivalHouses.js';
import './cadetBranches.js';
import './kinCrimes.js';
// The knife: hands, eyes, noses, tongues — and aids for your own losses (systems/maiming.js)
import './maiming.js';
// The scaffold: public executions, the crowd, martyrs' shrines (systems/executions.js)
import './executions.js';
// The dead on show and war trophies (systems/gibbets.js)
import './gibbets.js';
// The dungeon: prisoners put to the question (systems/interrogation.js)
import './interrogation.js';
// The fate of prisoners after a battle: the captives scene, ransoms, oaths, stakes (player/prisonerFates.js)
import './prisonerFates.js';
import './townsfolk.js';
import './discovery.js';
import './outlawLairs.js';
import './merchantCaravans.js';
import './merchantHouses.js';
import './deeds.js';
import './counsel.js';
import './patronage.js';
import './bank.js';
import './merchantPrince.js';
import './labour.js';
import './migration.js';
import './guilds.js';
import './merchantLedger.js';
import './hinterland.js';
import './languages.js';
// What people say of you: hearsay about the player in this town (systems/hearsay.js)
import './hearsay.js';
import './commissions.js';
import './arms.js';
import './tradePolicy.js';
import './laws.js';
// Schools & Letters: the town's literacy, its schools, your lessons, endowing a school (systems/literacy.js)
import './school.js';
import './harvests.js';
import './underwriting.js';
import './bourse.js';
import './mints.js';
import './estates.js';
import './puttingOut.js';
import './economy.js';
import './publicWorks.js';
// Works of the Ages: cathedrals, universities, bridges, canals, walls over generations (systems/greatWorks.js)
import './greatWorks.js';
import './treasury.js';
import './annals.js';
import './timeline.js';
import './almanac.js';
import './dynastyTree.js';
import './reckoning.js';
import './calendar.js';
import './timeSkip.js';
import './scenario.js';
import './atrocities.js';
import './harrying.js';

// Every panel's show* method is remembered, so the open panel redraws after the day (ui/panelRefresh.js)
trackShows(ActionMenu);
// The panels an origin's First Steps ask to see tick the step however they are opened (ui/actionMenu/counsel.js)
trackFirstStepsPanels(ActionMenu);

// Expose ActionMenu globally so inline onclick handlers in dynamic HTML can access it
window.ActionMenu = ActionMenu;

export { ActionMenu };
