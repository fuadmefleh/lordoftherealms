// ============================================
// BLOCKADE RUNNING — slipping past the royal squadrons
// ============================================
//
// A royal fleet blockading an enemy realm keeps squadrons on station off its
// ports (world/navySquadrons.js). A voyage bound into such a port — or out of
// one — heaves to off the harbour mouth (systems/shipVoyages.js sets
// voyage.blockade; the ship lies off, day after day, until the captain
// decides). This is that decision, as a choice scene (ui/actionMenu/
// blockadeScenes.js):
//
//   SIGHTED   run past now (by day), wait for dark and run (the day ends),
//             heave to and be searched (not at war: a loose blockade lets
//             you through for dues on the cargo; a close one turns you
//             away), attack the squadron (a sea fight on the water, or
//             fought out at once), lie off a day (the weather may turn),
//             turn back.
//   CAUGHT    seen running: fight (on the water, or at once), try to
//             outsail them, or strike (cargo seized, a fine at war).
//
// The odds of slipping past are NavySquadrons.slipChance: the dark, the
// weather at the port (fog, storm, rain), your speed against theirs, your
// stealth and your ship's, how many sail are on watch and how close the
// blockade is. Through, the ship makes port (in) or sails on (out); a
// ship that ran into a shut harbour may trade there (Ships honours
// player.blockadeRun) and her buyers pay a runner's premium.
// A fight beaten off thins the blockader's fleet (its navy strength), which
// may break the blockade the next day (world/kingdomNavy.js).
//
// Rolls are player actions on Utils; fights through systems/seaFights.js.
// Explicit params, no DOM.

import { Utils } from '../core/utils.js';
import { NavySquadrons } from '../world/navySquadrons.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { Ships } from './ships.js';
import { SeaFights } from './seaFights.js';
import { Traits } from './traits.js';
import { Ledger } from './ledger.js';

const DEFAULTS = {
    searchDues: 0.15,        // share of each good taken as dues when searched under a loose blockade
    seizedNeutral: 0.3,      // share taken from a runner caught (not at war)
    seizedWar: 0.5,          // ...and from an enemy's ship
    finePerStrength: 3,      // gold fine at war, per point of the squadron's strength
    flee: { base: 0.35, speed: 0.08, night: 0.15, min: 0.05, max: 0.85 },
    fleetLoss: 0.5,          // share of the squadron's strength lost when beaten
    renown: 3,
    warScore: 12,
    runnerDays: 10,          // days a runner may trade in the shut harbour she slipped into
    runnerPremium: 1.4,      // what buyers in a shut harbour pay a runner over the blockade price
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const BlockadeRunning = {
    DEFAULTS,

    config() {
        return DEFAULTS;
    },

    // ──────────── STATE ────────────

    /** The blockade the player's voyage waits on, or null. */
    pending(player) {
        const v = Ships.getVoyage(player);
        return v && v.blockade ? v.blockade : null;
    },

    /** A blockade scene for the voyage's waiting blockade. */
    start(player, world) {
        const b = BlockadeRunning.pending(player);
        const ship = Ships.getVoyageShip(player);
        if (!b || !ship) return null;
        const sq = NavySquadrons.get(world, b.squadronId) || ((NavySquadrons.guarding(world, b.portQ, b.portR) || {}).squadron) || null;
        if (!sq) return null;
        return {
            kind: 'blockade', phase: 'sighted', shipId: ship.id, squadronId: sq.id,
            kingdomId: sq.kingdomId, kingdomName: sq.kingdomName, targetName: sq.targetName,
            portQ: b.portQ, portR: b.portR, portName: b.portName, dir: b.dir, closed: !!b.closed,
            strength: sq.strength, ships: sq.ships, log: [],
        };
    },

    _ship(player, state) {
        return Ships.getShipById(player, state.shipId);
    },

    _kingdom(world, state) {
        return world && world.getKingdom ? world.getKingdom(state.kingdomId) : null;
    },

    /** At war with the blockading realm (or your liege is)? */
    atWar(player, world, state) {
        return Ships.fleetHostility(player, world, BlockadeRunning._kingdom(world, state)) === 'war';
    },

    _weather(world, state) {
        const w = world && world.weather && typeof world.weather.getWeather === 'function' ? world.weather.getWeather(state.portQ, state.portR) : null;
        return (w && w.type) || 'clear';
    },

    /** The odds of running past unseen, with their parts. */
    odds(player, world, state, night = false) {
        const ship = BlockadeRunning._ship(player, state);
        const fx = ship ? (Ships.getShipEffectiveStats(ship).effects || {}) : {};
        const sq = NavySquadrons.get(world, state.squadronId);
        return NavySquadrons.slipChance({
            night, weather: BlockadeRunning._weather(world, state),
            speed: ship ? Ships.getSailingSpeed(player, ship) : 3,
            squadronSpeed: sq ? sq.speed : 5,
            stealth: _num(player.skills && player.skills.stealth), shipStealth: _num(fx.stealthBonus),
            ships: sq ? sq.ships : state.ships, closed: state.closed,
        });
    },

    fleeChance(player, world, state, night = false) {
        const F = BlockadeRunning.config().flee;
        const ship = BlockadeRunning._ship(player, state);
        const sq = NavySquadrons.get(world, state.squadronId);
        const c = F.base + ((ship ? Ships.getSailingSpeed(player, ship) : 3) - (sq ? sq.speed : 5)) * F.speed + (night ? F.night : 0);
        return Math.max(F.min, Math.min(F.max, c));
    },

    /** The squadron's ships for a sea fight (systems/seaFights.js specs). */
    enemySpecs(world, state) {
        const sq = NavySquadrons.get(world, state.squadronId);
        return SeaFights.enemyNavy(sq ? sq.strength : state.strength, sq ? sq.name : `${state.kingdomName}'s squadron`);
    },

    // ──────────── THE SCENE ────────────

    view(player, world, state) {
        if (!state) return null;
        const ship = BlockadeRunning._ship(player, state);
        if (!ship) return null;
        const opt = (id, icon, label, hint, chance, extra = {}) => ({ id, icon, label, hint, chance, can: true, reason: '', cost: '', ...extra });
        const war = BlockadeRunning.atWar(player, world, state);
        const wx = BlockadeRunning._weather(world, state);
        const day = BlockadeRunning.odds(player, world, state, false);
        const night = BlockadeRunning.odds(player, world, state, true);
        const out = {
            icon: '⚓', title: `The Blockade of ${state.portName}`,
            stats: [`${state.ships} sail`, `strength ${state.strength}`, `your ship ${Math.round(Ships._getShipCombatStrength(ship, player))}`, `hull ${Math.round(ship.condition)}%`, `weather: ${wx}`],
            lines: [], log: state.log, options: [],
        };
        if (war) out.lines.push(`You are at war with ${state.kingdomName}: they will take your ship's cargo, or fight her.`);
        else out.lines.push(state.closed ? 'A close blockade: the harbour is shut to all shipping.' : 'They stop and search what comes and goes.');
        out.lines.push(`Your odds by day: ${day.parts.map(p => `${p.label} ${p.value >= 0 ? '+' : ''}${Math.round(p.value * 100)}%`).join(', ')}.`);
        if (state.phase === 'sighted') {
            out.text = state.dir === 'in'
                ? `Off ${state.portName}: ${state.ships} sail of ${state.kingdomName} on station across the harbour mouth, blockading the ports of ${state.targetName || 'the realm'}.`
                : `The ${ship.name} is ready to sail, but ${state.ships} sail of ${state.kingdomName} lie across the mouth of ${state.portName}.`;
            out.options.push(opt('run_now', '⛵', 'Run past them now', 'Crowd on sail and go, in daylight.', day.chance));
            out.options.push(opt('run_night', '🌙', 'Wait for dark, then run', 'The day passes lying off; then a dark run with no lights.', night.chance));
            out.options.push(opt('submit', '🏳️', 'Heave to and be searched', war ? 'You are at war with them: they would take her.' : (state.closed ? 'They will turn you away, after a look in your hold.' : `They take ${Math.round(BlockadeRunning.config().searchDues * 100)}% of your cargo as dues, and let you through.`), null, { odds: false, can: !war, reason: 'At war with them' }));
            out.options.push(opt('fight_sail', '⚔️', 'Attack the squadron under sail', 'Take the deck: close, rake, grapple — your squadron with you.', null, { odds: false }));
            out.options.push(opt('fight', '💥', 'Attack — fight it out at once', 'The sailing master fights her; the dice decide.', null, { odds: false }));
            out.options.push(opt('wait', '⏳', 'Lie off a day', 'Wait for fog, a storm, or a gap in the line.', null, { odds: false }));
            out.options.push(opt('turn_back', '↩️', state.dir === 'in' ? 'Turn back' : 'Stay in port', state.dir === 'in' ? 'Give it up: heave to and take the helm.' : 'Tie up again.', null, { odds: false }));
            return out;
        }
        if (state.phase === 'caught') {
            out.text = `Seen! ${state.ships > 1 ? 'The squadron comes about' : 'She comes about'} and runs out her guns. ${war ? 'They mean to take you.' : 'A gun fired across your bow: heave to.'}`;
            out.options.push(opt('fight_sail', '⚔️', 'Fight them under sail', 'Take the deck and fight it out on the water.', null, { odds: false }));
            out.options.push(opt('fight', '💥', 'Fight it out at once', 'The dice decide.', null, { odds: false }));
            if (!state.fled) out.options.push(opt('flee', '💨', 'Outsail them', 'Back out to sea before they close.', BlockadeRunning.fleeChance(player, world, state, !!state.night)));
            out.options.push(opt('strike', '🏳️', 'Strike your colours', war ? 'They take half your cargo and fine you.' : 'They take a share of your cargo and turn you away.', null, { odds: false }));
            return out;
        }
        return null;
    },

    act(player, world, state, choice) {
        if (!state) return { done: true };
        const ship = BlockadeRunning._ship(player, state);
        if (!ship) return { done: true, notification: { title: 'At Sea', body: 'Your ship is no longer under you.', type: 'error' } };
        const go = (phase, note, extra = {}) => ({ state: { ...state, ...extra, phase, log: [...(state.log || []), note] } });
        const war = BlockadeRunning.atWar(player, world, state);
        if (state.phase === 'sighted') {
            if (choice === 'run_now' || choice === 'run_night') {
                const night = choice === 'run_night';
                const ok = Utils.random() < BlockadeRunning.odds(player, world, state, night).chance;
                if (player.skills) player.skills.stealth = Math.min(10, _num(player.skills.stealth, 1) + (ok ? 0.15 : 0.05));
                if (ok) return { ...BlockadeRunning._through(player, world, state, ship, night ? '🌙 No lights, not a word aboard: you slip past their line in the dark.' : '⛵ Under every stitch of canvas you run past their line before they can close.'), endDay: night };
                return go('caught', night ? '🔦 A lantern on the water — their guard boat has seen you.' : '👀 Their lookouts have you.', { night, endDay: night });
            }
            if (choice === 'submit') {
                if (war) return { invalid: true, notification: { title: 'At War', body: `${state.kingdomName} would take your ship.`, type: 'error' } };
                return BlockadeRunning._submit(player, world, state, ship);
            }
            if (choice === 'fight') return BlockadeRunning.fightNow(player, world, state);
            if (choice === 'wait') {
                BlockadeRunning._log(ship, world, '⏳', 'Lay off the blockade a day, watching their line.');
                return { done: true, endDay: true, notification: { title: '⏳ Lying Off', body: `You stand off ${state.portName} and watch the squadron's line. Tomorrow the weather may turn.`, type: 'info' } };
            }
            if (choice === 'turn_back') return BlockadeRunning._turnBack(player, world, state, ship, 'You give it up.');
            return { invalid: true };
        }
        if (state.phase === 'caught') {
            if (choice === 'fight') return BlockadeRunning.fightNow(player, world, state);
            if (choice === 'flee' && !state.fled) {
                const ok = Utils.random() < BlockadeRunning.fleeChance(player, world, state, !!state.night);
                if (ok) return BlockadeRunning._turnBack(player, world, state, ship, '💨 You outsail them back out to sea.');
                return go('caught', 'They are faster: you cannot shake them.', { fled: true });
            }
            if (choice === 'strike') return BlockadeRunning._caught(player, world, state, ship, war ? 'You strike your colours.' : 'You heave to under their guns.');
            return { invalid: true };
        }
        return { done: true };
    },

    /** Walked away from: she lies off as she was (the voyage asks again tomorrow). */
    abandon() {
        return null;
    },

    // ──────────── OUTCOMES ────────────

    _log(ship, world, icon, text) {
        if (ship && ship.voyage) Ships._voyageLog(ship, icon, text, world);
    },

    /** Through the line: into port (in), or out to sea on her course (out). */
    _through(player, world, state, ship, lead) {
        const v = ship.voyage;
        Traits.recordDeed(player, 'seafaring', 1);
        if (!v) return { done: true, notification: { title: '⛵ Through', body: lead, type: 'success' } };
        v.blockade = null;
        v.blockadePassed = true;
        if (state.dir === 'out') {
            BlockadeRunning._log(ship, world, '⛵', `Ran the blockade out of ${state.portName}.`);
            return { done: true, notification: { title: '⛵ Through the Blockade', body: `${lead} The open sea is ahead; the voyage goes on.`, type: 'success' } };
        }
        BlockadeRunning._makePort(player, world, ship, state);
        player.blockadeRun = { q: state.portQ, r: state.portR, day: world.day || 0, until: (world.day || 0) + BlockadeRunning.config().runnerDays, kingdomId: state.kingdomId };
        return {
            done: true,
            notification: { title: '⚓ Blockade Run', body: `${lead} The ${ship.name} makes ${state.portName}${state.closed ? ' — the only ship to come in for weeks: her cargo will fetch a runner\'s price' : ''}.`, type: 'success' },
        };
    },

    /** Make port at the blockaded harbour (the voyage's own landfall). */
    _makePort(player, world, ship, state) {
        const v = ship.voyage;
        ship.status = 'docked';
        ship.dockedAt = state.portName;
        ship.q = state.portQ; ship.r = state.portR;
        player.q = state.portQ; player.r = state.portR;
        player.boardedShip = null;
        if (v) Ships._endVoyage(ship, world, `Ran the blockade into ${state.portName} after ${v.day} day${v.day === 1 ? '' : 's'} at sea.`);
    },

    /** Give it up: heave to at sea (in), or tie up again in port (out). */
    _turnBack(player, world, state, ship, lead) {
        const v = ship.voyage;
        if (v) v.blockade = null;
        if (state.dir === 'out') {
            if (v) Ships._endVoyage(ship, world, `Stayed in ${state.portName}: the blockade holds.`);
            ship.status = 'docked';
            ship.dockedAt = state.portName;
            ship.q = state.portQ; ship.r = state.portR;
            player.q = state.portQ; player.r = state.portR;
            player.boardedShip = null;
            return { done: true, notification: { title: '⚓ Still in Port', body: `${lead} The ${ship.name} ties up again in ${state.portName}.`, type: 'info' } };
        }
        if (v) Ships._endVoyage(ship, world, `Turned back from the blockade off ${state.portName}.`, '↩️');
        if (ship.status === 'docked') ship.status = 'at_sea';
        return { done: true, notification: { title: '↩️ Turned Back', body: `${lead} You stand off ${state.portName} with the helm in your hands: sail where you will.`, type: 'info' } };
    },

    _seize(player, world, ship, share, cause) {
        const seized = {};
        for (const [good, qty] of Object.entries(ship.cargo || {})) {
            const n = Math.floor(qty * share);
            if (n <= 0) continue;
            ship.cargo[good] -= n;
            if (ship.cargo[good] <= 0) delete ship.cargo[good];
            seized[good] = n;
        }
        if (Object.keys(seized).length) Ships._reportSeaLoss(player, world, ship, 0, seized, cause);
        return seized;
    },

    _goodsText(seized) {
        return Object.entries(seized).map(([g, n]) => `${n} ${g.replace(/_/g, ' ')}`).join(', ');
    },

    /** Heave to and be searched (not at war). */
    _submit(player, world, state, ship) {
        const C = BlockadeRunning.config();
        const seized = BlockadeRunning._seize(player, world, ship, state.closed ? 0 : C.searchDues, `dues to ${state.kingdomName}'s blockade`);
        const took = BlockadeRunning._goodsText(seized);
        if (state.closed) return BlockadeRunning._turnBack(player, world, state, ship, `Their boarding officer looks in your hold and turns you away: the harbour is shut.`);
        const res = BlockadeRunning._through(player, world, state, ship, `Searched and let through${took ? `, less ${took} as dues` : ''}.`);
        return res;
    },

    /** Caught and struck: cargo taken (and a fine at war), turned away. */
    _caught(player, world, state, ship, lead) {
        const C = BlockadeRunning.config();
        const war = BlockadeRunning.atWar(player, world, state);
        const seized = BlockadeRunning._seize(player, world, ship, war ? C.seizedWar : C.seizedNeutral, `seized by ${state.kingdomName}'s blockade`);
        let fine = 0;
        if (war) {
            fine = Math.min(_num(player.gold), Math.round(state.strength * C.finePerStrength));
            if (fine > 0) {
                player.gold -= fine;
                const k = BlockadeRunning._kingdom(world, state);
                if (k) k.treasury = _num(k.treasury) + fine;
                Ledger.record(player, 'seaFines', -fine);
            }
        }
        const took = BlockadeRunning._goodsText(seized);
        const res = BlockadeRunning._turnBack(player, world, state, ship, `${lead} They take ${took || 'nothing worth having'}${fine ? ` and ${Utils.formatGold(fine)} gold` : ''}, and send you off.`);
        res.notification.title = '🏳️ Caught Running';
        res.notification.type = 'error';
        return res;
    },

    /** Fight the squadron at once: the sea fight sailed out by the sailing master. */
    fightNow(player, world, state) {
        const specs = SeaFights.playerSide(player, world);
        if (!specs.length) return { done: true, notification: { title: 'At Sea', body: 'You are not aboard.', type: 'error' } };
        const f = SeaFights.create(specs, BlockadeRunning.enemySpecs(world, state), { night: !!state.night, weather: BlockadeRunning._weather(world, state) });
        SeaFights.autoResolve(f);
        return BlockadeRunning.settleFight(player, world, state, f);
    },

    /**
     * The end of a fight with the blockade (on the water, or at once):
     * beaten, the squadron's realm loses ships and you go through; you ran
     * or drew off, you turn back; beaten yourself, you are caught.
     */
    settleFight(player, world, state, f) {
        const C = BlockadeRunning.config();
        const fleet = SeaFights.applyToFleet(player, world, f);
        const ship = BlockadeRunning._ship(player, state);
        const o = f.outcome || { kind: 'escaped' };
        const log = [...(state.log || []), ...f.log.slice(-4), ...fleet.lines];
        if (!ship) return { done: true, log, notification: { title: '🌊 Lost', body: 'Your ship is gone.', type: 'error' } };
        Ships._setMorale(ship, Ships.getMorale(ship) + (o.kind === 'victory' ? 6 : o.kind === 'defeat' ? -12 : -2));
        if (o.kind === 'victory') {
            const k = BlockadeRunning._kingdom(world, state);
            const loss = Math.ceil(_num(state.strength) * C.fleetLoss);
            if (k && k.navy) k.navy.strength = Math.max(0, _num(k.navy.strength) - loss);
            NavySquadrons.reset(world);
            player.renown = _num(player.renown) + C.renown;
            const war = player.realmWars && player.realmWars.wars && player.realmWars.wars[state.kingdomId];
            if (war) war.score = _num(war.score) + C.warScore;
            Traits.recordDeed(player, 'valor', 1);
            // (a ship of theirs carried by boarding: her crew yield to you, player/prisonerFates.js)
            SeaFights.boardedYield(world, f, { kingdomId: state.kingdomId, name: `${state.kingdomName || 'The squadron'}'s sailors`, q: typeof ship.q === 'number' ? ship.q : player.q, r: typeof ship.r === 'number' ? ship.r : player.r });
            const res = BlockadeRunning._through(player, world, state, ship, `⚔️ You beat the squadron off (${SeaFights.summary(f) || 'they gave way'}). +${C.renown} renown${war ? `, +${C.warScore} war score` : ''}; ${state.kingdomName}'s fleet is the weaker by ${loss}.`);
            return { ...res, log };
        }
        if (o.kind === 'defeat') {
            const res = BlockadeRunning._caught(player, world, state, ship, o.how === 'boarded' ? 'Their boarders carried your deck.' : 'Shot to pieces, you struck.');
            return { ...res, log };
        }
        const res = BlockadeRunning._turnBack(player, world, state, ship, o.how === 'drawn' ? 'You and the squadron draw off, both the worse for it.' : 'You draw away from their guns.');
        return { ...res, log };
    },

    /**
     * A ship that ran the blockade into this shut harbour may trade here a
     * while (Ships._closedPortMessage, Ships.portSaleUnitPrice read it).
     */
    isRunnerAt(player, world, q, r) {
        const b = player && player.blockadeRun;
        return !!(b && b.q === q && b.r === r && _num(b.until) >= ((world && world.day) || 0));
    },

    /** Kingdom navy strength the squadron draws on (for the panels). */
    fleetOf(world, state) {
        const k = BlockadeRunning._kingdom(world, state);
        return k ? KingdomNavy.effectiveStrength(k) : 0;
    },
};
