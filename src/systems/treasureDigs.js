// ============================================
// TREASURE DIGS — what lies under the X, and who stands over it
// ============================================
// A treasure map's cache (tile.buried, laid by Cartography.generateTreasureMap)
// used to pay its gold and quietly forget its items. Now:
//
//   • The cache has an ORIGIN — a pirate hoard, a bandit stash, a noble's
//     cache, an ancient tomb (data/cartography.json → treasureDigs.origins) —
//     picked from the hex by a hash of the world seed, biased by the terrain
//     (pirates bury on beaches, tombs lie in deserts and mountains). No
//     Utils draw at generation time, so world generation and the goldens are
//     untouched; the origin is fixed per hex and noted on tile.buried.origin.
//   • The origin decides the loot added to the map's gold and items, and the
//     ENCOUNTER at the dig (also a hash): nothing, a trap (disarm / work
//     around it slowly / force it), a guardian (fight / sneak / bribe /
//     pray — a tomb's keeper takes no coin) or rivals digging first (race /
//     negotiate a split / fight / let them have it).
//   • The items are really given (PlayerInventory.addItem, respecting the
//     packs' capacity); what doesn't fit stays buried as a smaller cache on
//     the hex (tile.buried.loot) to come back for.
//
// The scene is driven by the choice-scene UI (ui/actionMenu/treasureScenes.js);
// Cartography.digTreasure, the old one-step dig, now hands over the items too
// (giveLoot). Explicit params; randomness through Utils; no DOM.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { PlayerInventory } from '../core/inventory.js';
import { Quests } from './quests.js';
import { Traits } from './traits.js';
import { Ledger } from './ledger.js';
import { Heirlooms } from './heirlooms.js';

const DEFAULTS = {
    legacyItems: { ancient_relic: 'ancient_artifact' },
    origins: {
        bandit_stash: {
            name: 'Bandit Stash', icon: '🗡️', weight: 1, terrains: [], terrainWeight: 1, goldMult: 1, loot: {},
            encounters: { none: 1 }, guardian: 'guards', trap: 'a trap', rivals: 'rivals',
        },
    },
    odds: {
        fight: { base: 0.35, combat: 0.05, strength: 0.01, armyBonus: 0.15 },
        sneak: { base: 0.25, stealth: 0.06 },
        bribe: { base: 0.75, diplomacy: 0.02, costShare: 0.25, min: 20 },
        prayer: { base: 0.3, karmaPer: 0.005, faith: 0.02 },
        disarm: { base: 0.3, intelligence: 0.03, cartography: 0.04 },
        force: { base: 0.45, strength: 0.02 },
        race: { base: 0.35, strength: 0.02, mount: 0.15 },
        negotiate: { base: 0.4, diplomacy: 0.05, charisma: 0.02 },
    },
    hurt: { trap: [8, 20], fight: [6, 16], guardianTomb: [12, 25] },
    renown: { fight: 3, found: 2 },
    slowAP: 3,
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v) => Math.max(0.05, Math.min(0.95, v));

function _hash(...parts) {
    const s = parts.join('|');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    return h >>> 0;
}

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

function _skill(player, id) {
    return _num(player && player.skills && player.skills[id], 1);
}

function _weightedHash(weights, ...parts) {
    const entries = Object.entries(weights || {}).filter(([, w]) => w > 0);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    if (!entries.length || total <= 0) return null;
    let roll = (_hash(...parts) / 4294967296) * total;
    for (const [id, w] of entries) {
        if (roll < w) return id;
        roll -= w;
    }
    return entries[entries.length - 1][0];
}

let _cfg = null;
let _cfgSrc;

export const TreasureDigs = {
    DEFAULTS,

    config() {
        const gd = DataLoader._gamedata;
        const src = (gd && gd.cartography && gd.cartography.treasureDigs) || null;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const o = src || {};
            _cfg = {
                ...DEFAULTS, ...o,
                origins: o.origins && Object.keys(o.origins).length ? o.origins : DEFAULTS.origins,
                odds: { ...DEFAULTS.odds, ...(o.odds || {}) },
                hurt: { ...DEFAULTS.hurt, ...(o.hurt || {}) },
                renown: { ...DEFAULTS.renown, ...(o.renown || {}) },
                legacyItems: { ...DEFAULTS.legacyItems, ...(o.legacyItems || {}) },
            };
        }
        return _cfg;
    },

    origin(id) {
        const o = TreasureDigs.config().origins;
        return o[id] || o[Object.keys(o)[0]];
    },

    /** The origin of a cache at (q, r): a terrain-biased hash pick, fixed per hex. */
    originAt(world, q, r) {
        const tile = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        if (tile && tile.buried && tile.buried.origin && TreasureDigs.config().origins[tile.buried.origin]) return tile.buried.origin;
        const terrain = tile && tile.terrain ? tile.terrain.id : null;
        const weights = {};
        for (const [id, o] of Object.entries(TreasureDigs.config().origins)) {
            weights[id] = _num(o.weight, 1) * ((o.terrains || []).includes(terrain) ? _num(o.terrainWeight, 1) : 1);
        }
        return _weightedHash(weights, _seed(world), 'cache-origin', q, r) || Object.keys(weights)[0];
    },

    /** What waits at the dig: 'none' | 'trap' | 'guardian' | 'rivals' (a hash, fixed per hex). */
    encounterAt(world, q, r, originId) {
        const o = TreasureDigs.origin(originId);
        return _weightedHash(o.encounters || { none: 1 }, _seed(world), 'cache-encounter', q, r) || 'none';
    },

    /** Is there something to dig up here? */
    hasCache(tile) {
        return !!(tile && tile.buried && !tile.buried.discovered);
    },

    /** The cache's goods as { id: qty }: the map's items, its origin's loot, and anything left behind before. */
    lootOf(world, tile, originId = null) {
        const b = tile && tile.buried;
        if (!b) return {};
        const cfg = TreasureDigs.config();
        const out = {};
        const add = (id, n) => {
            if (!(n > 0)) return;
            const real = cfg.legacyItems[id] || id;
            out[real] = (out[real] || 0) + n;
        };
        for (const id of Array.isArray(b.items) ? b.items : []) add(id, 1);
        for (const [id, n] of Object.entries(b.loot || {})) add(id, _num(n));
        if (originId && !b.leftover) {
            for (const [id, range] of Object.entries(TreasureDigs.origin(originId).loot || {})) {
                const lo = Array.isArray(range) ? range[0] : _num(range);
                const hi = Array.isArray(range) ? range[1] : _num(range);
                add(id, lo + (_hash(_seed(world), 'cache-loot', tile.q, tile.r, id) % (Math.max(0, hi - lo) + 1)));
            }
        }
        return out;
    },

    /**
     * Hand over a share of the cache: gold (on the Ledger) and the goods that
     * fit in the packs. What doesn't fit stays buried here (tile.buried.loot).
     * opts.originLoot adds the origin's loot (the scene), off for the old dig.
     * Returns { gold, added, left }.
     */
    giveLoot(player, world, tile, share = 1, opts = {}) {
        const b = tile && tile.buried;
        if (!b || b.discovered) return { gold: 0, added: {}, left: {} };
        const originId = opts.originLoot ? (b.origin || TreasureDigs.originAt(world, tile.q, tile.r)) : null;
        const mult = originId && !b.leftover ? _num(TreasureDigs.origin(originId).goldMult, 1) : 1;
        const gold = Math.max(0, Math.round(_num(b.gold) * mult * share));
        const goods = TreasureDigs.lootOf(world, tile, originId);
        const take = {};
        for (const [id, n] of Object.entries(goods)) {
            const q = share >= 1 ? n : Math.floor(n * share);
            if (q > 0) take[id] = q;
        }
        if (gold > 0) {
            player.gold = _num(player.gold) + gold;
            Ledger.record(player, 'exploration', gold);
        }
        const res = PlayerInventory.addItems(player, take);
        const left = res.dropped;
        if (Object.keys(left).length) {
            tile.buried = { gold: 0, items: [], loot: left, discovered: false, origin: b.origin || originId || null, leftover: true, encounterDone: true };
        } else {
            b.discovered = true;
            if (tile.improvement && tile.improvement.type === 'treasure_cache') tile.improvement = null;
        }
        // A cache dug up for the first time may hold a named thing for the House (systems/heirlooms.js)
        const heirloom = b.leftover ? null : Heirlooms.onDig(player, world, tile);
        return { gold, added: res.added, left, heirloom };
    },

    /** The cache is lost to someone else (rivals got it). */
    _lose(tile) {
        if (!tile || !tile.buried) return;
        tile.buried.discovered = true;
        tile.buried.takenByRivals = true;
        if (tile.improvement && tile.improvement.type === 'treasure_cache') tile.improvement = null;
    },

    // ── Odds (deterministic) ──────────────────────────

    chance(player, kind, state = {}) {
        const o = TreasureDigs.config().odds;
        const p = player || {};
        switch (kind) {
            case 'fight': {
                let c = o.fight.base + _skill(p, 'combat') * o.fight.combat + _num(p.strength, 5) * o.fight.strength;
                if ((p.army || []).length) c += o.fight.armyBonus;
                if (state.origin === 'ancient_tomb' && state.encounter === 'guardian') c -= 0.1;
                return _clamp(c);
            }
            case 'sneak': return _clamp(o.sneak.base + _skill(p, 'stealth') * o.sneak.stealth);
            case 'bribe': return _clamp(o.bribe.base + _skill(p, 'diplomacy') * o.bribe.diplomacy);
            case 'prayer': return _clamp(o.prayer.base + Math.max(0, _num(p.karma)) * o.prayer.karmaPer + _num(p.faith, 0) * o.prayer.faith);
            case 'disarm': return _clamp(o.disarm.base + _num(p.intelligence, 5) * o.disarm.intelligence + _skill(p, 'cartography') * o.disarm.cartography);
            case 'force': return _clamp(o.force.base + _num(p.strength, 5) * o.force.strength);
            case 'race': return _clamp(o.race.base + _num(p.strength, 5) * o.race.strength + (p.mount ? o.race.mount : 0));
            case 'negotiate': return _clamp(o.negotiate.base + _skill(p, 'diplomacy') * o.negotiate.diplomacy + _num(p.charisma, 5) * o.negotiate.charisma);
            default: return 0.5;
        }
    },

    bribeCost(tile) {
        const o = TreasureDigs.config().odds.bribe;
        return Math.max(o.min, Math.round(_num(tile && tile.buried && tile.buried.gold) * o.costShare));
    },

    // ── The scene ─────────────────────────────────────

    /** Start a dig at the player's hex. Returns { state } or { error }. */
    begin(player, world, q = player.q, r = player.r) {
        const tile = world && world.getTile ? world.getTile(q, r) : null;
        if (!TreasureDigs.hasCache(tile)) return { error: 'Nothing buried here.' };
        const origin = TreasureDigs.originAt(world, q, r);
        tile.buried.origin = origin;
        const encounter = tile.buried.encounterDone ? 'none' : TreasureDigs.encounterAt(world, q, r, origin);
        return { state: { q, r, origin, encounter, phase: encounter === 'none' ? 'dig' : 'encounter', share: 1, log: [] } };
    },

    _tile(world, st) {
        return world && world.getTile ? world.getTile(st.q, st.r) : null;
    },

    view(player, world, st) {
        const tile = TreasureDigs._tile(world, st);
        if (!st || !TreasureDigs.hasCache(tile)) return null;
        const o = TreasureDigs.origin(st.origin);
        const opt = (id, icon, label, hint, chance, extra = {}) => ({ id, icon, label, hint, chance, can: true, ...extra });
        const leftover = !!tile.buried.leftover;
        const view = {
            icon: o.icon, title: leftover ? 'The Rest of the Cache' : `${o.name}`,
            stats: [`❤️ ${Math.round(_num(player.health, 100))}`, `💰 ${Math.floor(_num(player.gold))}`, `🎒 ${PlayerInventory.getFreeSlots(player)} free slots`],
            log: st.log, options: [],
        };
        if (st.phase === 'dig') {
            view.text = leftover ? 'What you could not carry last time is still where you left it.'
                : `The marks on your map match the ground. Whatever ${o.name.toLowerCase()} this was, it is yours to dig up${st.share < 1 ? ' — what is left of it' : ''}.`;
            view.options.push(opt('dig', '⛏️', 'Dig it up', 'Gold to the purse; goods to your packs as far as they will hold — the rest stays buried here.', null));
            view.footer = 'Digging takes the rest of the day.';
            return view;
        }
        if (st.encounter === 'trap') {
            view.text = `The cache is here — and so is ${o.trap}.`;
            view.options.push(opt('disarm', '🔧', 'Disarm it', 'Wits and a mapmaker\'s eye. Fail and it goes off in your face; some of the cache is ruined.', TreasureDigs.chance(player, 'disarm', st)));
            const ap = _num(TreasureDigs.config().slowAP, 3);
            const can = _num(player.actionPoints, 10) >= ap;
            view.options.push(opt('slow', '🐢', 'Work around it slowly', 'Dig from the side, inch by inch. Safe, but it costs time.', null, { cost: `${ap} AP`, can, reason: can ? '' : `Needs ${ap} AP` }));
            view.options.push(opt('force', '💪', 'Force it open', 'Quick and brutal. If it springs, it springs hard.', TreasureDigs.chance(player, 'force', st)));
            view.options.push(opt('leave', '🚶', 'Leave it for now', 'Walk away. The cache will still be here.', null, { odds: false }));
        } else if (st.encounter === 'guardian') {
            view.text = `As the spade bites, you are not alone: ${o.guardian}.`;
            view.options.push(opt('fight', '⚔️', 'Fight for it', 'Your blade and your strength (soldiers at your back help).', TreasureDigs.chance(player, 'fight', st)));
            view.options.push(opt('sneak', '🌑', 'Wait for dark and sneak in', 'Stealth. Spotted, it comes to a fight on their terms.', TreasureDigs.chance(player, 'sneak', st)));
            if (st.origin === 'ancient_tomb') {
                view.options.push(opt('prayer', '🙏', 'Make an offering to the dead', 'Karma and faith. The dead do not take coin.', TreasureDigs.chance(player, 'prayer', st)));
            } else {
                const cost = TreasureDigs.bribeCost(tile);
                const can = _num(player.gold) >= cost;
                view.options.push(opt('bribe', '💰', 'Buy them off', 'A share of the cache, paid up front from your purse.', TreasureDigs.chance(player, 'bribe', st), { cost: `${cost} gold`, can, reason: can ? '' : `They want ${cost} gold` }));
            }
            view.options.push(opt('leave', '🚶', 'Back away', 'Live to dig another day. The cache stays where it is.', null, { odds: false }));
        } else if (st.encounter === 'rivals') {
            view.text = `Someone got here first: ${o.rivals}. They have not reached it yet.`;
            view.options.push(opt('race', '🏃', 'Race them to it', 'Strength and a horse. Lose and they carry it off.', TreasureDigs.chance(player, 'race', st)));
            view.options.push(opt('negotiate', '🤝', 'Offer to split it', 'Half each, if they listen. If not, steel comes out.', TreasureDigs.chance(player, 'negotiate', st)));
            view.options.push(opt('fight', '⚔️', 'Drive them off', 'Win, and it all comes to you. Lose, and it all goes to them.', TreasureDigs.chance(player, 'fight', st)));
            view.options.push(opt('yield', '🏳️', 'Let them have it', 'Not worth blood. The cache is theirs.', null, { odds: false }));
        }
        return view;
    },

    _hurt(player, range) {
        const [lo, hi] = Array.isArray(range) ? range : [5, 10];
        const n = Utils.randInt(lo, hi);
        player.health = Math.max(1, _num(player.health, 100) - n);
        return n;
    },

    _train(player, skill, amt) {
        if (!player.skills) player.skills = {};
        player.skills[skill] = Math.min(10, _num(player.skills[skill], 1) + amt);
    },

    _fightRoll(player, world, st, lead) {
        const cfg = TreasureDigs.config();
        const ok = Utils.random() < TreasureDigs.chance(player, 'fight', st);
        TreasureDigs._train(player, 'combat', ok ? 0.2 : 0.05);
        const hurt = TreasureDigs._hurt(player, st.origin === 'ancient_tomb' && st.encounter === 'guardian' ? cfg.hurt.guardianTomb : cfg.hurt.fight);
        if (ok) {
            Traits.recordDeed(player, 'valor', 1);
            player.renown = _num(player.renown) + cfg.renown.fight;
            const next = { ...st, phase: 'dig', log: [...st.log, `${lead}You won the fight (−${hurt} health, +${cfg.renown.fight} renown).`] };
            return { state: next };
        }
        const tile = TreasureDigs._tile(world, st);
        if (st.encounter === 'rivals') {
            TreasureDigs._lose(tile);
            return { endDay: true, notification: { title: '💀 Beaten to It', body: `${lead}They beat you off (−${hurt} health) and carried the cache away.`, type: 'error' } };
        }
        return { endDay: true, notification: { title: '💀 Driven Off', body: `${lead}You were driven off (−${hurt} health). The cache is still down there.`, type: 'error' } };
    },

    act(player, world, st, choice) {
        const tile = TreasureDigs._tile(world, st);
        if (!TreasureDigs.hasCache(tile)) return { notification: { title: 'Nothing Here', body: 'The cache is gone.', type: 'error' } };
        const cfg = TreasureDigs.config();
        const o = TreasureDigs.origin(st.origin);
        const roll = (k) => Utils.random() < TreasureDigs.chance(player, k, st);
        const toDig = (line, extra = {}) => ({ state: { ...st, ...extra, phase: 'dig', log: [...st.log, line] } });

        if (st.phase === 'dig') {
            if (choice !== 'dig') return { invalid: true };
            const firstTime = !tile.buried.leftover;
            const res = TreasureDigs.giveLoot(player, world, tile, st.share, { originLoot: true });
            TreasureDigs._train(player, 'cartography', 0.3);
            if (firstTime) {
                Quests.track(player, 'treasures_found');
                player.renown = _num(player.renown) + cfg.renown.found;
            }
            const got = PlayerInventory.describe(res.added);
            const left = PlayerInventory.describe(res.left);
            let body = `You dug up ${res.gold} gold${got ? ` and ${got}` : ''}.`;
            if (res.heirloom) body += ` Among it lay ${res.heirloom.name}: it is the House's now.`;
            if (left) body += ` Your packs are full: ${left} stay${Object.keys(res.left).length === 1 ? 's' : ''} buried here for another day.`;
            return { endDay: true, gold: res.gold, added: res.added, left: res.left, notification: { title: `${o.icon} Treasure Found!`, body, type: left ? 'warning' : 'success' } };
        }

        switch (choice) {
            case 'leave':
                return { notification: { title: 'You Walk Away', body: 'The cache stays buried. You can come back for it.', type: 'info' } };
            case 'yield':
                TreasureDigs._lose(tile);
                return { notification: { title: '🏳️ Let Them Have It', body: 'You leave the rivals to their digging. The cache is theirs.', type: 'warning' } };
            case 'disarm': {
                const ok = roll('disarm');
                TreasureDigs._train(player, 'cartography', 0.1);
                if (ok) return toDig('You found the trigger and made it safe.');
                const hurt = TreasureDigs._hurt(player, cfg.hurt.trap);
                return toDig(`It went off as you worked (−${hurt} health); part of the cache is ruined.`, { share: st.share * 0.7 });
            }
            case 'slow': {
                const ap = _num(cfg.slowAP, 3);
                if (_num(player.actionPoints, 10) < ap) return { invalid: true, notification: { title: 'Too Tired', body: `You need ${ap} AP to dig around it.`, type: 'error' } };
                player.actionPoints = _num(player.actionPoints, 10) - ap;
                return toDig('You dug around it, slowly and safely.');
            }
            case 'force': {
                const ok = roll('force');
                if (ok) return toDig('You wrenched it open before it could spring.');
                const hurt = TreasureDigs._hurt(player, [cfg.hurt.trap[0] + 4, cfg.hurt.trap[1] + 8]);
                return toDig(`It sprang hard (−${hurt} health); half the cache is ruined.`, { share: st.share * 0.5 });
            }
            case 'fight':
                return TreasureDigs._fightRoll(player, world, st, '');
            case 'sneak': {
                const ok = roll('sneak');
                TreasureDigs._train(player, 'stealth', ok ? 0.2 : 0.05);
                if (ok) return toDig('You slipped past in the dark.');
                return TreasureDigs._fightRoll(player, world, st, 'They spotted you. ');
            }
            case 'prayer': {
                if (st.origin !== 'ancient_tomb') return { invalid: true };
                const ok = roll('prayer');
                if (ok) {
                    player.karma = _num(player.karma) + 1;
                    return toDig('The air stilled. Whatever kept the tomb lets you pass (+1 karma).');
                }
                return TreasureDigs._fightRoll(player, world, st, 'Your offering was not accepted. ');
            }
            case 'bribe': {
                if (st.origin === 'ancient_tomb') return { invalid: true };
                const cost = TreasureDigs.bribeCost(tile);
                if (_num(player.gold) < cost) return { invalid: true, notification: { title: 'Purse Too Light', body: `They want ${cost} gold.`, type: 'error' } };
                player.gold -= cost;
                Ledger.record(player, 'exploration', -cost);
                if (roll('bribe')) return toDig(`You paid ${cost} gold and they looked the other way.`);
                return TreasureDigs._fightRoll(player, world, st, `They took your ${cost} gold and drew steel anyway. `);
            }
            case 'race': {
                const ok = roll('race');
                if (ok) return toDig('You got there first.');
                TreasureDigs._lose(tile);
                return { endDay: true, notification: { title: '🏃 Too Slow', body: 'They reached it first and were gone with the cache before you caught your breath.', type: 'error' } };
            }
            case 'negotiate': {
                const ok = roll('negotiate');
                TreasureDigs._train(player, 'diplomacy', ok ? 0.2 : 0.05);
                if (ok) return toDig('They agreed to split it: half each.', { share: st.share * 0.5 });
                return TreasureDigs._fightRoll(player, world, st, 'They would not share. ');
            }
            default:
                return { invalid: true };
        }
    },
};
