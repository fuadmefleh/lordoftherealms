// ============================================
// ACTION MENU — assembled from ./actionMenu/*.js
// ============================================
import { ActionMenu } from './_ref.js';
import { trackShows } from '../panelRefresh.js';
import './core.js';
import './trade.js';
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
import './dutyScenes.js';
import './winterScenes.js';
import './jobs.js';
import './gambling.js';
import './realm.js';
import './skills.js';
import './social.js';
import './houseShips.js';
import './tradeLines.js';
import './riverLife.js';
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
import './royalCourt.js';
import './holdings.js';
import './stewards.js';
import './holdingSieges.js';
import './rivals.js';
import './heirs.js';
import './heirAgency.js';
import './raising.js';
import './abdication.js';
import './afterlife.js';
import './parents.js';
import './sagas.js';
import './whispers.js';
import './letters.js';
import './threats.js';
import './crises.js';
import './nemesis.js';
// Friends & Bonds: sworn kin, drinking companions, mentors, protégés (systems/bonds.js)
import './bonds.js';
// Your Crimes & Enemies: charge sheets, bounty hunters, blood debts (systems/wanted.js)
import './wanted.js';
import './lodging.js';
import './townLots.js';
import './peopleCrimes.js';
import './graveyards.js';
import './townCrimes.js';
// Profane crimes: a rival House's crypt, the relic trade (systems/profaneCrimes.js)
import './profane.js';
import './sickness.js';
import './livestock.js';
import './furnishing.js';
import './household.js';
import './courierRiders.js';
import './rivalHouses.js';
import './cadetBranches.js';
import './kinCrimes.js';
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

// Every panel's show* method is remembered, so the open panel redraws after the day (ui/panelRefresh.js)
trackShows(ActionMenu);

// Expose ActionMenu globally so inline onclick handlers in dynamic HTML can access it
window.ActionMenu = ActionMenu;

export { ActionMenu };
