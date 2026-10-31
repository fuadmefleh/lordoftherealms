// ============================================
// MAP THEFT — whose map you took, and how they come after you
// ============================================
// Steal Maps used to be one anonymous roll. Now the player picks a mark
// among the named owners of a town (data/cartography.json → mapTheft.targets):
//
//   📐 a cartographer      a fine regional chart; accuses you when you return
//   ⚓ a ship's captain    a sea chart, sometimes his treasure map; posts a bounty
//   🏛️ the lord's archive  a chart of the realm; heat with the crown and a bounty
//
// Names are hashed from the town (no RNG), so the same town always has the
// same cartographer. Each target has its own odds (stealth, luck) and chance
// of being caught in the act (arrest into the town jail, heat, a theft
// rumour). A theft that works is remembered (player.mapGrudges, saved): after
// a few days the owner may find out (better stealth, better odds he never
// does). Then he follows up — a bounty (Gossip), heat with the crown
// (Underworld), or, for the cartographer, an accusation when you next walk
// into his town: pay restitution, deny it, buy his silence or run.
//
// processDay(world, player) runs the follow-ups on its own seeded stream (it
// draws only while a grudge is open). The accusation is a choice scene
// (ui/actionMenu/treasureScenes.js). Explicit params; Utils RNG; no DOM.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { Cartography } from './cartography.js';
import { Underworld } from './underworld.js';
import { Gossip } from './gossip.js';
import { Ledger } from './ledger.js';

const DEFAULTS = {
    targets: {
        cartographer: { label: 'Cartographer', icon: '📐', titles: ['Master'], trade: 'cartographer', base: 0.5, stealth: 0.06, caught: 0.4, map: 'regional', accuracy: [0.7, 0.9], quality: 'detailed', value: [40, 90], discoverDays: [2, 5], followUp: 'accuse', bountyGold: 60, restitution: 2 },
    },
    surnames: ['Vell'],
    firstNames: ['Aldric'],
    shipNames: ['Gull'],
    luck: 0.01,
    discoverBase: 0.75,
    discoverStealth: 0.05,
    remember: 120,
    accuseWaitDays: 30,
    accuse: {
        deny: { base: 0.25, diplomacy: 0.05, charisma: 0.02 },
        bribe: { base: 0.6, diplomacy: 0.03, costMult: 1.5 },
        flee: { base: 0.35, stealth: 0.05 },
    },
    jailDays: [2, 5, 8],
    jailBailPerDay: 25,
};

const TYPE_RANK = { village: 0, town: 1, city: 2, capital: 3 };
const WATER = ['ocean', 'deep_ocean', 'coast', 'sea'];
const OPEN = ['unaware', 'discovered', 'bounty'];

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo = 0.05, hi = 0.95) => Math.max(lo, Math.min(hi, v));
const _day = (world) => _num(world && world.day);

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

const _pick = (arr, ...parts) => (arr && arr.length ? arr[_hash(...parts) % arr.length] : '');
const _seed = (world) => (world && world.generationParams && world.generationParams.seed) || 0;

let _cfg = null;
let _cfgSrc;

export const MapTheft = {
    DEFAULTS,

    config() {
        const gd = DataLoader._gamedata;
        const src = (gd && gd.cartography && gd.cartography.mapTheft) || null;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const o = src || {};
            _cfg = { ...DEFAULTS, ...o, accuse: { ...DEFAULTS.accuse, ...(o.accuse || {}) }, targets: o.targets && Object.keys(o.targets).length ? o.targets : DEFAULTS.targets };
        }
        return _cfg;
    },

    /** The player's grudges (created / backfilled). */
    grudges(player) {
        if (!player) return [];
        if (!Array.isArray(player.mapGrudges)) player.mapGrudges = [];
        return player.mapGrudges;
    },

    _coastal(world, q, r) {
        if (!world || typeof world.getTile !== 'function') return false;
        return Hex.neighbors(q, r).some(n => {
            const t = world.getTile(Hex.wrapQ ? Hex.wrapQ(n.q, world.width) : n.q, n.r);
            return t && t.terrain && WATER.includes(t.terrain.id);
        });
    },

    /** The owner of maps of one kind at a town: name and blurb, hashed from the town. */
    ownerName(world, tile, targetId) {
        const cfg = MapTheft.config();
        const t = cfg.targets[targetId];
        const s = tile.settlement || {};
        const key = [_seed(world), s.name || `${tile.q},${tile.r}`, targetId];
        const first = _pick(cfg.firstNames, ...key, 'first');
        const sur = _pick(cfg.surnames, ...key, 'sur');
        const title = _pick(t.titles || [''], ...key, 'title');
        if (targetId === 'captain') return `${title} ${first} ${sur} of the ${_pick(cfg.shipNames, ...key, 'ship')}`.trim();
        if (targetId === 'archive') {
            const k = s.kingdom && world.getKingdom ? world.getKingdom(s.kingdom) : null;
            return `the archive of ${k ? k.name : s.name} (${title} ${first} ${sur})`;
        }
        return `${title} ${first} ${sur}, ${t.trade} of ${s.name || 'the town'}`.trim();
    },

    _ownerKey(tile, targetId) {
        return `${tile.q},${tile.r}:${targetId}`;
    },

    chance(player, targetId) {
        const cfg = MapTheft.config();
        const t = cfg.targets[targetId];
        if (!t) return 0;
        const stealth = _num(player.skills && player.skills.stealth, 1);
        return _clamp(_num(t.base) + stealth * _num(t.stealth) + (_num(player.luck, 5) - 5) * _num(cfg.luck));
    },

    caughtChance(player, targetId) {
        const t = MapTheft.config().targets[targetId];
        return t ? (1 - MapTheft.chance(player, targetId)) * _num(t.caught, 0.4) : 0;
    },

    /** The marks at this town: [{ id, icon, label, name, chance, caught, can, reason }]. */
    targets(player, world, tile) {
        const s = tile && tile.settlement;
        if (!s) return [];
        const cfg = MapTheft.config();
        const day = _day(world);
        const out = [];
        for (const [id, t] of Object.entries(cfg.targets)) {
            if (t.minType && _num(TYPE_RANK[s.type], 1) < _num(TYPE_RANK[t.minType], 0)) continue;
            if (t.coastal && !MapTheft._coastal(world, tile.q, tile.r)) continue;
            if (t.needsKingdom && !s.kingdom) continue;
            const key = MapTheft._ownerKey(tile, id);
            const recent = MapTheft.grudges(player).find(g => g.ownerKey === key && day - _num(g.day) < 30);
            out.push({
                id, icon: t.icon, label: t.label, name: MapTheft.ownerName(world, tile, id),
                chance: MapTheft.chance(player, id), caught: MapTheft.caughtChance(player, id),
                can: !recent, reason: recent ? 'Robbed lately: everything is under lock and key' : '',
                followUp: t.followUp,
            });
        }
        return out;
    },

    _range(range, d) {
        return Array.isArray(range) ? range[0] + Utils.random() * (range[1] - range[0]) : _num(range, d);
    },

    /** The map a theft from this owner yields (and, from a captain, maybe his treasure map). */
    _buildMaps(world, tile, targetId) {
        const t = MapTheft.config().targets[targetId];
        const radius = (Cartography.MAP_TYPES && Cartography.MAP_TYPES.regional && Cartography.MAP_TYPES.regional.radius) || 15;
        const acc = MapTheft._range(t.accuracy, 0.7);
        const value = Math.round(MapTheft._range(t.value, 50));
        const owner = MapTheft.ownerName(world, tile, targetId);
        const base = {
            id: `stolen_${Utils.nextId()}_${Utils.randInt(0, 9999)}`, icon: '🗡️', quality: t.quality || 'basic', accuracy: acc,
            createdDay: _day(world), createdBy: owner, value, deliberateErrors: [], isPropaganda: false, isStolen: true, isAncient: false,
            stolenFrom: owner,
        };
        const maps = [];
        if (t.map === 'kingdom') {
            const s = tile.settlement || {};
            const k = s.kingdom && world.getKingdom ? world.getKingdom(s.kingdom) : null;
            if (k && k.capital) {
                maps.push({
                    ...base, type: 'kingdom', name: `Stolen Chart of ${k.name}`, kingdomId: k.id, centerQ: k.capital.q, centerR: k.capital.r,
                    radius: (Cartography.MAP_TYPES.stolen && Cartography.MAP_TYPES.stolen.radius) || radius,
                    tiles: Cartography._chartKingdomTiles(k, world, acc), notes: `Taken from ${owner}.`,
                });
            }
        }
        if (!maps.length) {
            let cq = tile.q;
            let cr = tile.r;
            if (t.map === 'sea') {
                const w = Hex.neighbors(tile.q, tile.r).find(n => {
                    const tt = world.getTile(n.q, n.r);
                    return tt && tt.terrain && WATER.includes(tt.terrain.id);
                });
                if (w) { cq = w.q; cr = w.r; }
            }
            const region = Cartography._getRegionName(cq, cr, world);
            maps.push({
                ...base, type: 'regional', name: t.map === 'sea' ? `Sea Chart — ${region}` : `Stolen Chart — ${region}`,
                centerQ: cq, centerR: cr, radius, tiles: Cartography._chartTiles(cq, cr, radius, world, acc), notes: `Taken from ${owner}.`,
            });
        }
        if (t.treasureChance && Utils.random() < t.treasureChance) {
            const tm = Cartography.generateTreasureMap(world);
            if (tm) {
                tm.notes = `Found in the sea chest of ${owner}. ${tm.notes || ''}`.trim();
                tm.stolenFrom = owner;
                maps.push(tm);
            }
        }
        return maps;
    },

    /** Jail in the town (the shape every system uses for player.jailState). */
    _jail(player, settlementName, offense = 'map theft') {
        const cfg = MapTheft.config();
        if (!player.criminalRecord) player.criminalRecord = { pickpocket: 0, smuggling: 0, mapTheft: 0 };
        player.criminalRecord.mapTheft = _num(player.criminalRecord.mapTheft) + 1;
        const n = player.criminalRecord.mapTheft;
        const table = cfg.jailDays || [2, 5, 8];
        const days = n <= table.length ? table[n - 1] : table[table.length - 1] + 2 + (n - table.length) * 3;
        player.jailState = {
            daysRemaining: days, totalDays: days, offense, offenseNumber: n,
            settlement: settlementName || 'the town', bailCost: days * _num(cfg.jailBailPerDay, 25),
            escapeChance: 0.08 + _num(player.skills && player.skills.stealth) * 0.03,
        };
        player.stamina = 0;
        player.movementRemaining = 0;
        return days;
    },

    /**
     * Steal from one owner. Returns { success, caught, maps, message, jailDays?, owner }.
     * The maps go into player.maps (the caller reads them onto the map).
     */
    steal(player, world, tile, targetId) {
        const target = MapTheft.targets(player, world, tile).find(t => t.id === targetId);
        if (!target) return { success: false, caught: false, invalid: true, message: 'There is no such mark here.' };
        if (!target.can) return { success: false, caught: false, invalid: true, message: target.reason };
        const cfg = MapTheft.config();
        const t = cfg.targets[targetId];
        const s = tile.settlement;
        const day = _day(world);
        const roll = Utils.random();
        const stealth = _num(player.skills && player.skills.stealth, 1);
        if (!player.skills) player.skills = {};
        if (roll < target.chance) {
            const maps = MapTheft._buildMaps(world, tile, targetId);
            if (!player.maps) player.maps = [];
            player.maps.push(...maps);
            player.skills.stealth = Math.min(10, stealth + 0.1);
            player.skills.cartography = Math.min(10, _num(player.skills.cartography) + 0.1);
            Underworld.recordCrime(player, world, 'map_theft', { kingdom: s.kingdom || null });
            const [lo, hi] = t.discoverDays || [2, 5];
            MapTheft.grudges(player).push({
                id: `mg_${day}_${_hash(tile.q, tile.r, targetId, day) % 100000}`,
                ownerKey: MapTheft._ownerKey(tile, targetId), targetId, owner: target.name,
                settlement: s.name, q: tile.q, r: tile.r, kingdom: s.kingdom || null,
                mapIds: maps.map(m => m.id), value: maps.reduce((a, m) => a + _num(m.value), 0),
                day, discoverDay: day + lo + (_hash(tile.q, tile.r, targetId, day, 'd') % (Math.max(0, hi - lo) + 1)),
                discoverChance: _clamp(_num(cfg.discoverBase, 0.75) - stealth * _num(cfg.discoverStealth, 0.05), 0.1, 0.95),
                status: 'unaware',
            });
            return { success: true, caught: false, maps, map: maps[0], owner: target.name, message: `You lifted ${maps.map(m => m.name).join(' and ')} from ${target.name}.` };
        }
        if (roll < target.chance + target.caught) {
            player.karma = _num(player.karma) - 2;
            if (s.kingdom && player.reputation) player.reputation[s.kingdom] = Math.max(-100, _num(player.reputation[s.kingdom]) - 10);
            Underworld.recordCrime(player, world, 'map_theft', { kingdom: s.kingdom || null, caught: true, q: tile.q, r: tile.r, location: s.name, victim: { name: target.name, type: 'merchant', icon: t.icon } });
            const days = MapTheft._jail(player, s.name);
            MapTheft.grudges(player).push({
                id: `mg_${day}_${_hash(tile.q, tile.r, targetId, day) % 100000}`, ownerKey: MapTheft._ownerKey(tile, targetId), targetId,
                owner: target.name, settlement: s.name, q: tile.q, r: tile.r, kingdom: s.kingdom || null, mapIds: [], value: 0,
                day, status: 'jailed',
            });
            return { success: false, caught: true, jailDays: days, owner: target.name, message: `${target.name} caught you with your hand in the chest. The watch drags you off: ${days} days in jail (-2 karma, -10 reputation).` };
        }
        player.skills.stealth = Math.min(10, stealth + 0.05);
        return { success: false, caught: false, owner: target.name, message: `You could not get at ${target.name}'s maps unseen, and slipped away empty-handed.` };
    },

    _rng(world, player) {
        return Utils.seededRandom((_hash(_seed(world), 'map-theft', _day(world), (player && player.name) || '') % 233279) + 1);
    },

    _bounty(player, world, g, gold) {
        if (!g.kingdom) return;
        Gossip.initializePlayer(player);
        player.gossip.bounties = player.gossip.bounties.filter(b => b.grudgeId !== g.id);
        player.gossip.bounties.push({ rumorId: null, kingdom: g.kingdom, gold, issuedDay: _day(world), description: 'map_theft', grudgeId: g.id });
    },

    _clearBounty(player, g) {
        if (player.gossip && Array.isArray(player.gossip.bounties)) player.gossip.bounties = player.gossip.bounties.filter(b => b.grudgeId !== g.id);
    },

    /** The owners find out and follow up. Returns { notices }. */
    processDay(world, player) {
        const out = { notices: [] };
        const list = player && Array.isArray(player.mapGrudges) ? player.mapGrudges : null;
        if (!list || !list.length || !world) return out;
        const cfg = MapTheft.config();
        const day = _day(world);
        Utils.withRng(MapTheft._rng(world, player), () => {
            for (const g of list) {
                const t = cfg.targets[g.targetId] || {};
                if (g.status === 'unaware' && day >= _num(g.discoverDay)) {
                    if (Utils.random() < _num(g.discoverChance, 0.5)) {
                        g.status = 'discovered';
                        g.discoveredDay = day;
                        if (t.followUp === 'bounty' || t.followUp === 'heat') {
                            g.status = 'bounty';
                            MapTheft._bounty(player, world, g, _num(t.bountyGold, 60));
                            if (t.followUp === 'heat' && g.kingdom) Underworld.addHeat(player, g.kingdom, _num(t.heat, 15), world);
                            out.notices.push({ icon: t.icon || '📜', title: 'A Theft Found Out', text: `${g.owner} has found the chart missing and knows it was you: a bounty of ${_num(t.bountyGold, 60)} gold is on your head in ${g.settlement}'s realm.`, type: 'warning' });
                        } else {
                            out.notices.push({ icon: t.icon || '📜', title: 'A Theft Found Out', text: `Word reaches you that ${g.owner} has found his chart missing and names you as the thief. Do not show your face in ${g.settlement} unready.`, type: 'warning' });
                        }
                    } else {
                        g.status = 'clean';
                    }
                } else if (g.status === 'discovered' && day - _num(g.discoveredDay) >= _num(cfg.accuseWaitDays, 30)) {
                    g.status = 'bounty';
                    MapTheft._bounty(player, world, g, _num(t.bountyGold, 60));
                    out.notices.push({ icon: t.icon || '📜', title: 'Tired of Waiting', text: `${g.owner} went to the watch: there is a bounty on you for the stolen chart.`, type: 'warning' });
                }
            }
        });
        player.mapGrudges = list.filter(g => day - _num(g.day) < _num(cfg.remember, 120) && g.status !== 'settled');
        return out;
    },

    /** An owner who wants a word with you here, today (or null). */
    pendingAccusation(player, world) {
        if (!player || !Array.isArray(player.mapGrudges)) return null;
        const day = _day(world);
        return player.mapGrudges.find(g => (g.status === 'discovered' || g.status === 'bounty')
            && g.q === player.q && g.r === player.r && g.lastConfrontDay !== day) || null;
    },

    restitution(g) {
        const t = MapTheft.config().targets[g.targetId] || {};
        return Math.max(20, Math.round(_num(g.value, 40) * _num(t.restitution, 2)));
    },

    accuseChance(player, kind) {
        const a = MapTheft.config().accuse[kind] || {};
        const sk = (id) => _num(player.skills && player.skills[id], 1);
        if (kind === 'deny') return _clamp(_num(a.base) + sk('diplomacy') * _num(a.diplomacy) + _num(player.charisma, 5) * _num(a.charisma));
        if (kind === 'bribe') return _clamp(_num(a.base) + sk('diplomacy') * _num(a.diplomacy));
        if (kind === 'flee') return _clamp(_num(a.base) + sk('stealth') * _num(a.stealth));
        return 0.5;
    },

    accusationView(player, world, g) {
        const cost = MapTheft.restitution(g);
        const bribe = Math.round(cost * _num(MapTheft.config().accuse.bribe.costMult, 1.5));
        const held = (player.maps || []).some(m => (g.mapIds || []).includes(m.id));
        const t = MapTheft.config().targets[g.targetId] || {};
        return {
            icon: t.icon || '📜', title: 'Accused!',
            text: `${g.owner} blocks your way in ${g.settlement}, a guard at his shoulder: "That is the thief who took my ${t.map === 'kingdom' ? 'rolls' : 'chart'}!"`,
            stats: [`💰 ${Math.floor(_num(player.gold))}`, g.status === 'bounty' ? 'a bounty is out on you' : 'no bounty yet'],
            options: [
                { id: 'pay', icon: '💰', label: 'Pay restitution', hint: `${held ? 'Hand the chart back and pay' : 'Pay'} for the wrong. It ends here, bounty and all.`, chance: null, cost: `${cost} gold`, can: _num(player.gold) >= cost, reason: `You need ${cost} gold` },
                { id: 'deny', icon: '🗣️', label: 'Deny everything', hint: 'Diplomacy and charisma. Fail and the guard takes you in.', chance: MapTheft.accuseChance(player, 'deny') },
                { id: 'bribe', icon: '🤫', label: 'Buy his silence', hint: 'More than restitution, but no one need know. Refused, the guard sees the purse.', chance: MapTheft.accuseChance(player, 'bribe'), cost: `${bribe} gold`, can: _num(player.gold) >= bribe, reason: `You need ${bribe} gold` },
                { id: 'flee', icon: '🏃', label: 'Run for it', hint: 'Stealth. Away, and the realm hunts you; caught, it\'s jail.', chance: MapTheft.accuseChance(player, 'flee') },
            ],
            footer: 'Walk away from this and he goes straight to the watch.',
        };
    },

    _settle(player, g) {
        g.status = 'settled';
        MapTheft._clearBounty(player, g);
    },

    _fled(player, world, g) {
        g.status = 'bounty';
        const t = MapTheft.config().targets[g.targetId] || {};
        MapTheft._bounty(player, world, g, Math.round(_num(t.bountyGold, 60) * 1.5));
        if (g.kingdom) Underworld.addHeat(player, g.kingdom, 10, world);
    },

    /** Answer an accusation: 'pay' | 'deny' | 'bribe' | 'flee' | 'ignore'. Returns { ok, jailed, notification }. */
    answer(player, world, grudgeId, choice) {
        const g = MapTheft.grudges(player).find(x => x.id === grudgeId);
        if (!g) return { invalid: true, notification: { title: 'No One There', body: 'Your accuser is gone.', type: 'info' } };
        g.lastConfrontDay = _day(world);
        const cost = MapTheft.restitution(g);
        const arrest = (lead) => {
            const days = MapTheft._jail(player, g.settlement);
            MapTheft._settle(player, g);
            return { ok: false, jailed: days, notification: { title: '🚔 Arrested', body: `${lead} The guard takes you in: ${days} days in jail.`, type: 'error' } };
        };
        switch (choice) {
            case 'pay': {
                if (_num(player.gold) < cost) return { invalid: true, notification: { title: 'Purse Too Light', body: `You need ${cost} gold.`, type: 'error' } };
                player.gold -= cost;
                Ledger.record(player, 'fines', -cost);
                const before = (player.maps || []).length;
                player.maps = (player.maps || []).filter(m => !(g.mapIds || []).includes(m.id));
                MapTheft._settle(player, g);
                return { ok: true, notification: { title: '💰 Restitution', body: `You paid ${g.owner} ${cost} gold${player.maps.length < before ? ' and handed the chart back' : ''}. The matter is closed.`, type: 'warning' } };
            }
            case 'deny': {
                if (Utils.random() < MapTheft.accuseChance(player, 'deny')) {
                    MapTheft._settle(player, g);
                    return { ok: true, notification: { title: '🗣️ Not Proven', body: `You talked rings round ${g.owner}; the guard shrugs and walks off. He will not trouble you again.`, type: 'success' } };
                }
                return arrest('Your story did not hold.');
            }
            case 'bribe': {
                const bribe = Math.round(cost * _num(MapTheft.config().accuse.bribe.costMult, 1.5));
                if (_num(player.gold) < bribe) return { invalid: true, notification: { title: 'Purse Too Light', body: `You need ${bribe} gold.`, type: 'error' } };
                if (Utils.random() < MapTheft.accuseChance(player, 'bribe')) {
                    player.gold -= bribe;
                    Ledger.record(player, 'bribes', -bribe);
                    MapTheft._settle(player, g);
                    return { ok: true, notification: { title: '🤫 Silence Bought', body: `${bribe} gold changes hands; ${g.owner} remembers he must have mislaid the chart.`, type: 'warning' } };
                }
                if (g.kingdom) Underworld.addHeat(player, g.kingdom, 6, world);
                return arrest('The guard saw the purse.');
            }
            case 'flee': {
                if (Utils.random() < MapTheft.accuseChance(player, 'flee')) {
                    MapTheft._fled(player, world, g);
                    return { ok: true, notification: { title: '🏃 Away!', body: `You lost them in the alleys of ${g.settlement}. There is a bounty on you in this realm now.`, type: 'warning' } };
                }
                return arrest('They ran you down.');
            }
            case 'ignore':
            default:
                MapTheft._fled(player, world, g);
                return { ok: true, notification: { title: '📜 To the Watch', body: `You walked off on ${g.owner}; he went straight to the watch. There is a bounty on you.`, type: 'warning' } };
        }
    },
};
