// ============================================
// SEA INTERCEPTION — brought to by a royal patrol
// ============================================
//
// The patrol squadrons on the map (world/navySquadrons.js) are what stop the
// player's ships at sea. Each day Ships._interceptShips matches every ship
// under way or at anchor — her day's path — against the water each hostile
// patrol swept that day (NavySquadrons.patrolsAlong): a realm at war with
// you or your liege, or one that hates you (Ships.fleetHostility). No patrol
// near, no interception. Near one, its lookouts have her by
// NavySquadrons.catchChance (closeness, sail on the picket, the dark,
// weather, her speed against theirs, your stealth and her quiet fittings).
//
// Caught with you aboard, the ship is held (ship.intercept) and the captain
// chooses, as a blockade runner caught does (ui/actionMenu/blockadeScenes.js
// 'intercept' scene): fight under sail (ui/innerMapSeaFight.js, back through
// '__fought'), fight it out at once (SeaFights.autoResolve), outsail them
// (BlockadeRunning.fleeChance), or strike (cargo taken; a fine at war).
// Left undecided past the day, or caught sailing without you, her master
// decides (`masterDecides`): run if he can, fight if she is a match, else
// strike. Beating the squadron off thins its realm's navy (fleetLoss of the
// squadron), with renown and war score; beaten or struck, a share of each
// good in the hold is seized (data/military.json kingdomNavy.intercept).
//
// Rolls are on Utils (a player action, or the day's tick); fights through
// systems/seaFights.js. Explicit params, no DOM.

import { Utils } from '../core/utils.js';
import { NavySquadrons } from '../world/navySquadrons.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { Ships } from './ships.js';
import { SeaFights } from './seaFights.js';
import { BlockadeRunning } from './blockadeRunning.js';
import { Traits } from './traits.js';
import { Ledger } from './ledger.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const SeaInterception = {
    config() {
        return KingdomNavy.CONFIG.intercept;
    },

    // ──────────── STATE ────────────

    /** The interception holding the ship you are aboard, or null. */
    pending(player) {
        const ship = player && player.boardedShip != null ? Ships.getShipById(player, player.boardedShip) : null;
        return ship && ship.intercept ? ship.intercept : null;
    },

    /**
     * A patrol has `ship`: hold her (ship.intercept) for the captain's choice.
     * → the day's report ({ pending: true }).
     */
    hold(player, world, ship, squadron, stance, chance = null) {
        ship.intercept = {
            squadronId: squadron.id, kingdomId: squadron.kingdomId, kingdomName: squadron.kingdomName,
            name: squadron.name, stance, strength: _num(squadron.strength, 10), ships: _num(squadron.ships, 1),
            speed: _num(squadron.speed, 5), q: ship.q, r: ship.r, day: (world && world.day) || 0,
            chance: chance == null ? null : Math.round(chance * 100) / 100,
        };
        const text = `${squadron.ships} sail of ${squadron.kingdomName} (${squadron.name}) ${stance === 'war' ? 'run out their guns and bear down on' : 'fire a gun across the bow of'} the ${ship.name}.`;
        return { shipId: ship.id, name: ship.name, kingdomId: squadron.kingdomId, kingdomName: squadron.kingdomName, stance, pending: true, won: null, detachment: ship.intercept.strength, damage: 0, seized: {}, text };
    },

    /** The scene for the interception holding the ship you are aboard. */
    start(player, world) {
        const ship = player && Ships.getShipById(player, player.boardedShip);
        const h = ship && ship.intercept;
        if (!h) return null;
        return SeaInterception._state(ship, h);
    },

    _state(ship, h) {
        return {
            kind: 'intercept', phase: 'caught', shipId: ship.id, squadronId: h.squadronId,
            kingdomId: h.kingdomId, kingdomName: h.kingdomName, name: h.name, stance: h.stance,
            strength: h.strength, ships: h.ships, q: h.q, r: h.r, day: h.day, log: [],
        };
    },

    _ship(player, state) {
        return Ships.getShipById(player, state.shipId);
    },

    _kingdom(world, state) {
        return world && world.getKingdom ? world.getKingdom(state.kingdomId) : null;
    },

    atWar(player, world, state) {
        return Ships.fleetHostility(player, world, SeaInterception._kingdom(world, state)) === 'war';
    },

    _weather(world, state) {
        const w = world && world.weather && typeof world.weather.getWeather === 'function' && typeof state.q === 'number' ? world.weather.getWeather(state.q, state.r) : null;
        return (w && w.type) || 'clear';
    },

    /** The odds of outsailing them (the blockade runner's, by speed). */
    fleeChance(player, world, state) {
        return BlockadeRunning.fleeChance(player, world, state, false);
    },

    /** The squadron's ships for a sea fight (the same line a blockade fights with). */
    enemySpecs(world, state) {
        return BlockadeRunning.enemySpecs(world, state);
    },

    // ──────────── THE SCENE ────────────

    view(player, world, state) {
        if (!state) return null;
        const ship = SeaInterception._ship(player, state);
        if (!ship || !ship.intercept) return null;
        const opt = (id, icon, label, hint, chance, extra = {}) => ({ id, icon, label, hint, chance, can: true, reason: '', cost: '', ...extra });
        const war = SeaInterception.atWar(player, world, state);
        const I = SeaInterception.config();
        const share = Math.round((war ? I.warCargoSeized : I.cargoSeized) * 100);
        const out = {
            icon: '⚓', title: `Brought To by ${state.kingdomName}`,
            stats: [`${state.ships} sail`, `strength ${state.strength}`, `your ship ${Math.round(Ships._getShipCombatStrength(ship, player))}`, `hull ${Math.round(ship.condition)}%`, `weather: ${SeaInterception._weather(world, state)}`],
            lines: [war ? `You are at war with ${state.kingdomName}: they mean to take her.` : `${state.kingdomName} has no love for you: they will search her, and help themselves.`],
            log: state.log, options: [],
        };
        out.text = `${state.name} has you: ${state.ships > 1 ? `${state.ships} sail come about` : 'she comes about'} and ${war ? 'runs out her guns.' : 'fires a gun across your bow: heave to.'}`;
        out.options.push(opt('fight_sail', '⚔️', 'Fight them under sail', 'Take the deck and fight it out on the water.', null, { odds: false }));
        out.options.push(opt('fight', '💥', 'Fight it out at once', 'The sailing master fights her; the dice decide.', null, { odds: false }));
        if (!state.fled) out.options.push(opt('flee', '💨', 'Outsail them', 'Crowd on sail and run before they close.', SeaInterception.fleeChance(player, world, state)));
        out.options.push(opt('strike', '🏳️', war ? 'Strike your colours' : 'Heave to and be searched', war ? `They take ${share}% of your cargo and fine you.` : `They take ${share}% of your cargo and let you go.`, null, { odds: false }));
        return out;
    },

    act(player, world, state, choice) {
        if (!state) return { done: true };
        const ship = SeaInterception._ship(player, state);
        if (!ship || !ship.intercept) return { done: true, notification: { title: 'At Sea', body: 'The squadron is gone.', type: 'info' } };
        if (choice === 'fight') return SeaInterception.fightNow(player, world, state);
        if (choice === 'flee' && !state.fled) {
            const ok = Utils.random() < SeaInterception.fleeChance(player, world, state);
            if (ok) return SeaInterception._notify(SeaInterception._resolve(player, world, state, ship, 'fled', '💨 You outsail them and lose them astern.'));
            return { state: { ...state, fled: true, log: [...(state.log || []), 'They are faster: you cannot shake them.'] } };
        }
        if (choice === 'strike') return SeaInterception._notify(SeaInterception._resolve(player, world, state, ship, 'struck', SeaInterception.atWar(player, world, state) ? 'You strike your colours.' : 'You heave to under their guns.'));
        return { invalid: true };
    },

    /** Walked away from: she stays held; her master decides at the day's end. */
    abandon() {
        return null;
    },

    /** Fight the squadron at once: the sea fight sailed out by the sailing master. */
    fightNow(player, world, state) {
        const specs = SeaFights.playerSide(player, world);
        if (!specs.length) return { done: true, notification: { title: 'At Sea', body: 'You are not aboard.', type: 'error' } };
        const f = SeaFights.create(specs, SeaInterception.enemySpecs(world, state), { weather: SeaInterception._weather(world, state), context: 'intercept' });
        SeaFights.autoResolve(f);
        return SeaInterception.settleFight(player, world, state, f);
    },

    /** The end of a fight with the patrol (on the water, or at once). */
    settleFight(player, world, state, f) {
        const fleet = SeaFights.applyToFleet(player, world, f);
        const ship = SeaInterception._ship(player, state);
        const log = [...(state.log || []), ...f.log.slice(-4), ...fleet.lines];
        if (!ship) return { done: true, log, notification: { title: '🌊 Lost', body: 'Your ship is gone.', type: 'error' } };
        // (settled meanwhile — her master decided at the day's end)
        if (!ship.intercept) return { done: true, log, notification: { title: '⚓ At Sea', body: 'The squadron has drawn off.', type: 'info' } };
        const rep = SeaInterception._afterFight(player, world, state, ship, f);
        return { ...SeaInterception._notify(rep), log };
    },

    _afterFight(player, world, state, ship, f) {
        const o = f.outcome || { kind: 'escaped' };
        Ships._setMorale(ship, Ships.getMorale(ship) + (o.kind === 'victory' ? 6 : o.kind === 'defeat' ? -12 : -2));
        let rep;
        if (o.kind === 'victory') {
            rep = SeaInterception._resolve(player, world, state, ship, 'victory', `⚔️ The ${ship.name} beat off ${state.name} (${SeaFights.summary(f) || 'they gave way'}).`);
            // (a ship of the patrol carried by boarding with you aboard: her crew yield to you, player/prisonerFates.js)
            if (player.boardedShip === ship.id) SeaFights.boardedYield(world, f, { kingdomId: state.kingdomId, name: `${state.kingdomName || 'The patrol'}'s sailors`, q: typeof ship.q === 'number' ? ship.q : player.q, r: typeof ship.r === 'number' ? ship.r : player.r });
        }
        else if (o.kind === 'defeat') rep = SeaInterception._resolve(player, world, state, ship, 'defeat', o.how === 'boarded' ? 'Their boarders carried her deck.' : 'Shot to pieces, she struck.');
        else rep = SeaInterception._resolve(player, world, state, ship, 'drawn', o.how === 'drawn' ? `The ${ship.name} and the squadron draw off, both the worse for it.` : `The ${ship.name} draws away from their guns.`);
        rep.fought = true;
        rep.outcome = o.kind;
        return rep;
    },

    /**
     * Her master's call, with no captain to ask (a ship sailing without you,
     * or the day ended undecided): run if he can, fight if she is a match,
     * else strike. → the day's report
     */
    masterDecides(player, world, ship) {
        const h = ship && ship.intercept;
        if (!h) return null;
        const state = SeaInterception._state(ship, h);
        if (Utils.random() < SeaInterception.fleeChance(player, world, state)) {
            return SeaInterception._resolve(player, world, state, ship, 'fled', `💨 The ${ship.name}'s master crowded on sail and outran ${state.name}.`);
        }
        const aboard = player.boardedShip === ship.id;
        const own = Ships._getShipCombatStrength(ship, aboard ? player : null);
        if (own < state.strength * 0.6) {
            return SeaInterception._resolve(player, world, state, ship, 'struck', `Outgunned by ${state.name}, the ${ship.name}'s master hove to.`);
        }
        const specs = aboard ? SeaFights.playerSide(player, world) : [SeaFights.shipSpec(player, world, ship, { flagship: true })];
        const f = SeaFights.create(specs, SeaInterception.enemySpecs(world, state), { weather: SeaInterception._weather(world, state), context: 'intercept' });
        SeaFights.autoResolve(f);
        SeaFights.applyToFleet(player, world, f);
        if (!Ships.getShipById(player, ship.id)) return { shipId: ship.id, name: ship.name, kingdomId: state.kingdomId, kingdomName: state.kingdomName, stance: state.stance, won: false, fought: true, outcome: 'lost', detachment: state.strength, damage: 0, seized: {}, text: `The ${ship.name} was lost to ${state.name}.` };
        return SeaInterception._afterFight(player, world, state, ship, f);
    },

    // ──────────── OUTCOMES ────────────

    /**
     * Settle the interception: 'victory' (the squadron beaten off: its realm's
     * fleet thinned, renown, war score), 'defeat' / 'struck' (a share of the
     * cargo seized, a fine at war), 'fled' / 'drawn' (away, as she is).
     * Clears ship.intercept. → the report.
     */
    _resolve(player, world, state, ship, how, lead) {
        const I = SeaInterception.config();
        const war = SeaInterception.atWar(player, world, state);
        const condBefore = _num(ship.condition, 100);
        ship.intercept = null;
        const rep = {
            shipId: ship.id, name: ship.name, kingdomId: state.kingdomId, kingdomName: state.kingdomName, stance: state.stance,
            won: how === 'victory', outcome: how,
            detachment: state.strength, strength: Math.round(Ships._getShipCombatStrength(ship, player.boardedShip === ship.id ? player : null)),
            damage: 0, seized: {}, fine: 0,
        };
        let text = lead;
        if (how === 'victory') {
            const k = SeaInterception._kingdom(world, state);
            const loss = Math.ceil(_num(state.strength) * I.fleetLoss);
            if (k && k.navy) k.navy.strength = Math.max(0, _num(k.navy.strength) - loss);
            NavySquadrons.reset(world);
            player.renown = _num(player.renown) + I.renown;
            const w = player.realmWars && player.realmWars.wars && player.realmWars.wars[state.kingdomId];
            if (w) w.score = _num(w.score) + I.warScore;
            if (player.boardedShip === ship.id) Traits.recordDeed(player, 'valor', 1);
            text += ` +${I.renown} renown${w ? `, +${I.warScore} war score` : ''}; ${state.kingdomName}'s fleet is the weaker by ${loss}.`;
        } else if (how === 'defeat' || how === 'struck') {
            const seized = BlockadeRunning._seize(player, world, ship, war ? I.warCargoSeized : I.cargoSeized, `seized by ${state.kingdomName}'s squadron`);
            rep.seized = seized;
            let fine = 0;
            if (war) {
                fine = Math.min(_num(player.gold), Math.round(_num(state.strength) * BlockadeRunning.config().finePerStrength));
                if (fine > 0) {
                    player.gold -= fine;
                    const k = SeaInterception._kingdom(world, state);
                    if (k) k.treasury = _num(k.treasury) + fine;
                    Ledger.record(player, 'seaFines', -fine);
                }
            }
            rep.fine = fine;
            const took = BlockadeRunning._goodsText(seized);
            text += ` ${state.kingdomName}'s boarding officer took ${took || 'nothing worth having'}${fine ? ` and ${Utils.formatGold(fine)} gold` : ''}, and let her go.`;
        }
        rep.damage = Math.max(0, condBefore - _num(ship.condition, 100));
        if (rep.damage > 0) text += ` Hull -${Math.round(rep.damage)}%.`;
        rep.text = text;
        if (ship.voyage) Ships._voyageLog(ship, how === 'victory' ? '⚔️' : how === 'fled' ? '💨' : '⚓', text, world);
        return rep;
    },

    _notify(rep) {
        const title = { victory: '⚔️ Squadron Beaten Off', fled: '💨 Away Clear', drawn: '🌅 Drawn Off', defeat: '🏳️ Taken', struck: '🏳️ Searched and Plundered' }[rep.outcome] || '⚓ At Sea';
        const type = rep.outcome === 'victory' || rep.outcome === 'fled' ? 'success' : rep.outcome === 'drawn' ? 'info' : 'error';
        return { done: true, report: rep, notification: { title, body: rep.text, type } };
    },
};
