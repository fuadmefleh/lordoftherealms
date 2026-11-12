// ============================================
// PLAYER WORKS — the player's builds, one working day at a time
// ============================================
// The daily tick for everything the player has under construction:
// properties and tech buildings (tile.playerProperties), temples and shrines
// (tile.religiousBuilding), cultural buildings (tile.culturalBuilding) and
// roads, bridges and other infrastructure (tile.infrastructure, listed in
// player.infrastructureUnderConstruction). Each build's crews are paid, then
// its day of work is done at the pace of the season and the weather
// (systems/construction.js). Called from ui/game/endDay.js and the playtest
// harness; the player need not be anywhere near.

import { Construction } from '../systems/construction.js';
import { Infrastructure } from '../systems/infrastructure.js';
import { Quests } from '../systems/quests.js';
import { PlayerEconomy } from './playerEconomy.js';

export const PlayerWorks = {
    /**
     * Every build the player has under way: [{ kind, rec, q, r, name, icon, tile }].
     */
    list(player, world) {
        const out = [];
        if (!player || !world || typeof world.getTile !== 'function') return out;
        for (const ref of player.properties || []) {
            const tile = world.getTile(ref.q, ref.r);
            const prop = tile && PlayerEconomy.findPropertyAt(tile, ref.type);
            if (prop && prop.underConstruction) out.push({ kind: 'property', rec: prop, q: ref.q, r: ref.r, name: prop.name, icon: prop.icon || '🏗️', tile });
        }
        for (const ref of (player.religion && player.religion.buildings) || []) {
            const tile = world.getTile(ref.q, ref.r);
            const rb = tile && tile.religiousBuilding;
            if (rb && rb.underConstruction) out.push({ kind: 'religious', rec: rb, q: ref.q, r: ref.r, name: rb.name, icon: rb.icon || '⛪', tile });
        }
        for (const ref of player.culturalBuildings || []) {
            const tile = world.getTile(ref.q, ref.r);
            const cb = tile && tile.culturalBuilding;
            if (cb && cb.underConstruction) out.push({ kind: 'cultural', rec: cb, q: ref.q, r: ref.r, name: cb.name, icon: cb.icon || '🏛️', tile });
        }
        for (const ref of player.infrastructureUnderConstruction || []) {
            const tile = world.getTile(ref.q, ref.r);
            const inf = tile && tile.infrastructure;
            if (inf && inf.underConstruction) out.push({ kind: 'infrastructure', rec: inf, q: ref.q, r: ref.r, name: inf.name, icon: inf.icon || '🛤️', tile });
        }
        return out;
    },

    /**
     * One day of work on all of them.
     * → { completed: [{ kind, name, q, r, rec }], crewsLeft: [{ name, n }], wages }
     */
    processDay(player, world) {
        const out = { completed: [], crewsLeft: [], wages: 0 };
        if (!player || !world) return out;
        for (const w of PlayerWorks.list(player, world)) {
            const pay = Construction.payCrews(player, w.rec, world, w.q, w.r);
            out.wages += pay.paid;
            if (pay.left > 0) out.crewsLeft.push({ name: w.name, n: pay.left });
            if (!Construction.advance(w.rec, world, w.q, w.r)) continue;
            w.rec.crews = 0;
            if (w.kind === 'infrastructure') {
                Infrastructure.finishConstruction(world, w.tile);
            } else {
                w.rec.underConstruction = false;
                w.rec.constructionDaysLeft = 0;
                Quests.track(player, 'buildings_constructed');
            }
            out.completed.push({ kind: w.kind, name: w.name, q: w.q, r: w.r, rec: w.rec });
        }
        // Drop finished or vanished roads from the list the tick walks
        if (Array.isArray(player.infrastructureUnderConstruction)) {
            player.infrastructureUnderConstruction = player.infrastructureUnderConstruction.filter(ref => {
                const t = world.getTile(ref.q, ref.r);
                return !!(t && t.infrastructure && t.infrastructure.underConstruction);
            });
        }
        out.wages = Math.round(out.wages * 100) / 100;
        return out;
    },
};
