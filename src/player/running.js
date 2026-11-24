// Running on the street map (Shift held: ui/game/gameLoop.js sets
// InnerMap._runHeld, world/innerMap/movement.js runs while it is held and you
// aren't winded). What it does to you is here, a tile at a time:
//   • step(player): a tile run on foot costs energy (less with the Endurance
//     perk) and trains Endurance.
//   • winded(player, was): too spent to run — below windedBelow, and stays so
//     until energy is back above recoverAbove.
// Tuning in data/running.json. Explicit params; no randomness.

import { DataLoader } from '../core/dataLoader.js';
import { Endurance } from './endurance.js';

const DEFAULTS = { runPace: 1.8, energyPerTile: 0.35, xpPerTile: 0.05, windedBelow: 12, recoverAbove: 25 };

const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export const Running = {
    config() {
        const g = DataLoader._gamedata;
        return { ...DEFAULTS, ...((g && g.running) || {}) };
    },

    /** How much faster than a walk a run is. */
    pace() {
        const v = _num(Running.config().runPace, DEFAULTS.runPace);
        return v > 0 ? v : DEFAULTS.runPace;
    },

    /** Too spent to run? `was`: winded already (it takes recoverAbove energy to run again). */
    winded(player, was = false) {
        if (!player || !player.needs) return false;
        const C = Running.config();
        const e = _num(player.needs.energy, 100);
        return was ? e < _num(C.recoverAbove) : e < _num(C.windedBelow);
    },

    /** A tile run on foot: the energy it costs (spent), and a little Endurance for it. → energy spent */
    step(player) {
        if (!player || typeof player.modifyNeed !== 'function' || !player.needs) return 0;
        const C = Running.config();
        const cost = _num(C.energyPerTile) * Endurance.energyMult(player);
        if (cost > 0) player.modifyNeed('energy', -cost);
        Endurance.train(player, _num(C.xpPerTile));
        return cost;
    },
};
