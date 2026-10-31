// ActionMenu — winter work scenes (ui/actionMenu/choiceScenes.js).
//
// 'trap_furs':   on fresh ground, run the traps for a day (the old roll) or
//                lay a trap line that fills over the coming days; on a line
//                already set, empty it, mend and re-bait it, or take it up
//                (player/seasonalWork.js).
// 'ice_fishing': fish near the shore (safe, as of old) or walk out onto
//                thinner ice for a bigger catch, and from there further out
//                still — or back with what you have. Through the ice, the
//                catch is lost and the cold gets into you.
import { registerScene } from './choiceScenes.js';
import { SeasonalWork } from '../../player/seasonalWork.js';
import { PlayerInventory } from '../../player/inventory.js';

const _desc = (items) => SeasonalWork._describe(items || {}) || 'nothing';

function _tile(game, st) {
    return game.world.getTile(st.q, st.r);
}

// ── Trap lines ──

registerScene('trap_furs', {
    view(game, st) {
        const { player, world } = game;
        const tile = _tile(game, st);
        if (!tile) return null;
        const line = SeasonalWork.trapLineAt(player, st.q, st.r);
        if (line) {
            const days = Number.isFinite(world.day) ? Math.max(0, line.expiresDay - world.day) : 0;
            const lines = [`Set on day ${line.setDay}; runs ${days} more day${days === 1 ? '' : 's'} unless re-baited (and ends with the winter).`];
            if (line.raids) lines.push(`Raided ${line.raids} time${line.raids === 1 ? '' : 's'} so far.`);
            return {
                icon: '🕸️', title: 'Your Trap Line', panelTitle: '🕸️ Trap Line',
                stats: [`Held: ${_desc(line.catch)}`, line.damaged ? 'wrecked' : 'set', `🎒 ${PlayerInventory.getUsedSlots(player)}/${PlayerInventory.getCapacity(player)}`],
                text: line.damaged
                    ? 'Torn snares and scattered bait: something has been at your line. Mend it or it catches nothing.'
                    : 'You walk the line from snare to snare.',
                lines,
                options: [
                    { id: 'collect', icon: '🎒', label: 'Empty the snares', hint: 'Take what they hold and leave the line set.', chance: null, isDefault: true },
                    { id: 'reset', icon: '🔧', label: 'Empty, mend and re-bait', hint: 'Take the catch and set the line afresh — it runs another stretch of days.', chance: null },
                    { id: 'pull', icon: '🧺', label: 'Take the line up', hint: 'Empty it and carry the snares home.', chance: null },
                ],
            };
        }
        const check = SeasonalWork.canSetTrapLine(player, tile, world);
        return {
            icon: '🦊', title: 'Trapping in the Snow', panelTitle: '🦊 Trapping',
            stats: [`Trap lines: ${(player.trapLines || []).length}/${SeasonalWork._trapCfg().maxLines}`],
            text: 'Fresh tracks everywhere: fox, marten, hare. Winter coats are thick.',
            options: [
                { id: 'run', icon: '🦊', label: 'Run the traps today', hint: 'Set and check snares through the day for a catch tonight. Takes the day.', chance: null, isDefault: true },
                { id: 'set', icon: '🕸️', label: 'Lay a trap line', hint: 'Leave snares to fill over the coming days. Come back to empty them — wolves and poachers may get there first. Takes the day.', chance: null, can: check.ok, reason: check.reason },
            ],
        };
    },
    act(game, st, choice) {
        const { player, world } = game;
        const tile = _tile(game, st);
        if (choice === 'run') {
            const res = SeasonalWork.trapFurs(player, tile, world);
            if (!res.success) return { invalid: true, notification: { title: '🦊 Trapping', body: res.reason, type: 'error' } };
            return { endDay: true, notification: { title: '🦊 Trap Line', body: res.message, type: Object.keys(res.lost || {}).length ? 'warning' : 'success' } };
        }
        if (choice === 'set') {
            const res = SeasonalWork.setTrapLine(player, tile, world);
            if (!res.success) return { invalid: true, notification: { title: '🕸️ Trap Line', body: res.reason, type: 'error' } };
            return { endDay: true, notification: { title: '🕸️ Trap Line Set', body: res.message, type: 'success' } };
        }
        if (['collect', 'reset', 'pull'].includes(choice)) {
            const res = SeasonalWork.tendTrapLine(player, tile, world, choice);
            if (!res.success) return { invalid: true, notification: { title: '🕸️ Trap Line', body: res.reason, type: 'error' } };
            return { notification: { title: '🕸️ Trap Line', body: res.message, type: Object.keys(res.lost || {}).length ? 'warning' : 'success' } };
        }
        return { invalid: true };
    },
});

/** The trapping scene's state for this tile. */
export function startTrapping(game, tile) {
    return { q: tile.q, r: tile.r };
}

// ── Ice fishing ──

function _bank(player, items) {
    const { kept, lost } = SeasonalWork._bag(player, items);
    let body = Object.keys(kept).length ? `You walk back to shore with ${_desc(kept)}.` : 'You walk back to shore empty-handed.';
    if (Object.keys(lost).length) body += ` No room for ${_desc(lost)}.`;
    return body;
}

function _add(into, items) {
    for (const [id, q] of Object.entries(items || {})) into[id] = (into[id] || 0) + q;
    return into;
}

function _fell(out, st) {
    const lost = Object.keys(st.catch || {}).length ? ` Your catch (${_desc(st.catch)}) went to the bottom.` : '';
    const chill = out.chill ? ` ${out.chill.icon} The cold gets into you: ${out.chill.name}.` : '';
    return { endDay: true, notification: { title: '🧊 Through the Ice!', body: `The ice cracked and you went in. You hauled yourself out, half-drowned and frozen (−${out.healthLost} health).${lost}${chill}`, type: 'error' } };
}

registerScene('ice_fishing', {
    view(game, st) {
        const { player, world } = game;
        if (!_tile(game, st)) return null;
        if (st.stage === 'far') {
            const risk = SeasonalWork.thinIceChance(player, world, 2);
            return {
                icon: '🎣', title: 'Out on the Ice', panelTitle: '🧊 Ice Fishing',
                stats: [`Catch: ${_desc(st.catch)}`],
                text: 'Out here the big fish bite. Further out, past the dark patches, the ice groans under you.',
                options: [
                    { id: 'back', icon: '🏠', label: 'Head back with the catch', hint: 'Safe ground, and supper. Takes the day.', chance: null, isDefault: true },
                    { id: 'deeper', icon: '⚠️', label: 'Go further out', hint: 'Twice the catch again — or through the ice with all of it.', chance: 1 - risk },
                ],
            };
        }
        const risk = SeasonalWork.thinIceChance(player, world, 1);
        return {
            icon: '🧊', title: 'Ice Fishing', panelTitle: '🧊 Ice Fishing',
            stats: [`❤️ ${Math.round(player.health || 0)}`],
            text: 'Near the shore the ice is thick and the fish are small. Out in the middle, where it is thinner, the big ones lie.',
            options: [
                { id: 'shore', icon: '🎣', label: 'Fish near the shore', hint: 'A steady catch on safe ice. Takes the day.', chance: null, isDefault: true },
                { id: 'far', icon: '🧊', label: 'Walk out onto thinner ice', hint: 'A bigger catch and a chance at a great fish — if the ice holds.', chance: 1 - risk },
            ],
        };
    },
    act(game, st, choice) {
        const { player, world } = game;
        const tile = _tile(game, st);
        if (choice === 'shore') {
            const res = SeasonalWork.iceFish(player, tile, world);
            if (!res.success) return { invalid: true, notification: { title: '🧊 Ice Fishing', body: res.reason, type: 'error' } };
            return { endDay: true, notification: { title: '🧊 Ice Fishing', body: res.message, type: Object.keys(res.lost || {}).length ? 'warning' : 'success' } };
        }
        if (choice === 'far' && st.stage !== 'far') {
            if (!SeasonalWork.canIceFish(tile, world)) return { invalid: true, notification: { title: '🧊 Ice Fishing', body: 'The ice is gone.', type: 'error' } };
            const out = SeasonalWork.fishFarOut(player, world, 1);
            if (out.fell) return _fell(out, st);
            return { state: { ...st, stage: 'far', catch: _add({}, out.items) } };
        }
        if (choice === 'deeper' && st.stage === 'far') {
            const out = SeasonalWork.fishFarOut(player, world, 2);
            if (out.fell) return _fell(out, st);
            const all = _add({ ...st.catch }, out.items);
            return { endDay: true, notification: { title: '🎣 A Great Haul', body: `The far ice held. ${_bank(player, all)}`, type: 'success' } };
        }
        if (choice === 'back' && st.stage === 'far') {
            return { endDay: true, notification: { title: '🎣 Ice Fishing', body: _bank(player, st.catch), type: 'success' } };
        }
        return { invalid: true };
    },
    abandon(game, st) {
        // Out on the ice with a catch: you walk back with it
        if (st.stage === 'far' && Object.keys(st.catch || {}).length) {
            return { notification: { title: '🎣 Ice Fishing', body: _bank(game.player, st.catch), type: 'info' } };
        }
        return null;
    },
});

/** The ice-fishing scene's state for this tile. */
export function startIceFishing(game, tile) {
    return { q: tile.q, r: tile.r, stage: 'start', catch: {} };
}
