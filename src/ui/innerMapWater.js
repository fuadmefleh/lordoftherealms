// ============================================================
// INNER MAP — water by hand: wells, fountains, pools, rivers and lakes
// ============================================================
// A town's well, fountain well, pool or rain barrel, and the river or lake
// water on any street map (not the sea: salt), drunk from and filled from by
// hand (player/thirst.js). A town's wells are as clean or as foul as
// systems/water.js says (which ones: Water.fouledProps over the map's wells);
// a foul one is marked on the map (ui/innerMapLayers/wells.js), can be drunk
// anyway (the flux), cleared by paying the well-diggers, and a clean one can
// be fouled by you — poison or carrion down it, the town crime of
// systems/townCrimes.js poisonWell (seen → named, wanted).
//
//   menuItems(game, def, q, r)   a well prop's entries (customObjDef + anchor)
//   waterItems(game, tile, q, r) a fresh water tile's entries
//   handle(game, item)           'wm_*'
//   fouledHere(game)             the map's foul well anchors (the layer reads it)

import { InnerMap } from '../world/innerMap.js';
import { Thirst } from '../player/thirst.js';
import { Water } from '../systems/water.js';
import { TownCrimes } from '../systems/townCrimes.js';

const WELL_PROPS = new Set(['tp_well', 'tp_fountain', 'tp_pool', 'tp_water_barrel']);
const WELL_ONLY = new Set(['tp_well', 'tp_fountain']);

function _note(game, title, text, type = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, text, type);
}

function _town() {
    const ref = InnerMap._currentWorldTileRef;
    return ref && ref.settlement ? ref.settlement : null;
}

let _cache = { tiles: null, list: [] };

export const InnerMapWater = {
    isWellDef(def) {
        return !!(def && WELL_PROPS.has(def.id));
    },

    /** The anchors ("x,y") of the map's wells and fountain wells (cached per map). */
    wellAnchors() {
        const tiles = InnerMap.tiles;
        if (!Array.isArray(tiles)) return [];
        if (_cache.tiles === tiles) return _cache.list;
        const list = [];
        for (let r = 0; r < tiles.length; r++) {
            const row = tiles[r];
            if (!row) continue;
            for (let q = 0; q < row.length; q++) {
                const t = row[q];
                // (not a well you dug yourself: that one is yours alone — tile._hb, world/innerMap/handBuilding.js)
                if (t && t.customObject && WELL_ONLY.has(t.customObject.defId) && !t._hb) list.push(`${q},${r}`);
            }
        }
        _cache = { tiles, list };
        return list;
    },

    /** The foul wells on this map (a Set of "x,y"), empty outside a town. */
    fouledHere(game) {
        const s = _town();
        if (!s || !game || !game.world) return new Set();
        const w = s.water;
        if (!w && !(s.townCrimes && s.townCrimes.well)) return new Set();
        return Water.fouledProps(game.world, s, InnerMapWater.wellAnchors());
    },

    _sig: null,

    /**
     * Each frame (game/gameLoop.js via innerMapLayers/wells.js): the map's wells,
     * foul and clean, on InnerMap._wellState for the townsfolk's routines
     * (world/innerMap/townLife.js, townWork.js, townScenes.js) and the layer.
     * Recomputed only when the day, the map or the town's water record changes.
     */
    update(game) {
        const s = _town();
        const world = game && game.world;
        if (!s || !world) { InnerMap._wellState = null; InnerMapWater._sig = null; return; }
        const w = s.water;
        const tc = s.townCrimes && s.townCrimes.well;
        const sig = `${world.day}|${s.q},${s.r}|${w ? `${(w.foul || []).map(f => f.until).join('.')}:${w.hand ? w.hand.until : ''}:${w.dry ? w.dry.until : ''}` : '-'}|${tc ? tc.until : ''}`;
        if (sig === InnerMapWater._sig && InnerMap._wellState && InnerMap._wellState.tiles === InnerMap.tiles) return;
        InnerMapWater._sig = sig;
        const all = InnerMapWater.wellAnchors();
        const foul = InnerMapWater.fouledHere(game);
        InnerMap._wellState = { tiles: InnerMap.tiles, foul, clean: all.filter(k => !foul.has(k)), allFoul: foul.size > 0 && foul.size >= all.length };
    },

    _source(game, def, q, r) {
        const s = _town();
        const key = `${q},${r}`;
        // A well of your own (dug by hand on your ground): clean, and no one else's
        const at = InnerMap.getTile(q, r);
        if (at && at._hb && def && WELL_ONLY.has(def.id)) return { kind: 'well', label: 'your own well', foul: false, own: true, settlement: s, key };
        if (def && WELL_ONLY.has(def.id) && s) {
            const foul = InnerMapWater.fouledHere(game).has(key);
            const v = Water.view(game.world, s);
            return { kind: 'well', label: `the ${def.id === 'tp_fountain' ? 'fountain well' : 'well'}`, foul: foul || v.dry, dry: v.dry, settlement: s, key };
        }
        if (def && def.id === 'tp_water_barrel') return { kind: 'barrel', label: 'the rain barrel', foul: false, settlement: s, key };
        if (def && def.id === 'tp_pool') {
            const v = s ? Water.view(game.world, s) : null;
            return { kind: 'pool', label: 'the pool', foul: !!(v && !v.ok && !v.fresh), settlement: s, key };
        }
        return { kind: 'river', label: 'the water', foul: false, settlement: s, key };
    },

    /** Is the well prop at (q, r) foul (or dry)? */
    isFoulAt(game, def, q, r) {
        return !!(InnerMapWater.isWellDef(def) && game && game.world && InnerMapWater._source(game, def, q, r).foul);
    },

    /** A well inside: a castle's or a house's own (furniture type 'well') — clean water, Drink and Fill. */
    furnitureItems(game, furn, q, r) {
        if (!furn || furn.type !== 'well' || !game || !game.player || !Thirst.on(game.player)) return [];
        const room = Thirst.capacity(game.player) - Thirst.held(game.player);
        const label = `the ${String(furn.name || 'well').toLowerCase()}`;
        const items = [{ type: 'action', action: 'wm_drink', label: 'Drink', icon: '💧', desc: `Thirst ${Thirst.level(game.player)}% — draw a bucket and drink`, q, r, water: label }];
        if (room > 0) items.push({ type: 'action', action: 'wm_fill', label: 'Fill Your Waterskins', icon: '🎒', desc: `${room} draught${room === 1 ? '' : 's'} of room`, q, r, water: label });
        return items;
    },

    /** A well prop's entries. */
    menuItems(game, def, q, r) {
        if (!InnerMapWater.isWellDef(def) || !game || !game.player || !Thirst.on(game.player)) return [];
        const player = game.player;
        const src = InnerMapWater._source(game, def, q, r);
        const items = [];
        const lvl = Thirst.level(player);
        const room = Thirst.capacity(player) - Thirst.held(player);
        if (src.foul) {
            const v = src.settlement ? Water.view(game.world, src.settlement) : null;
            const c = v && v.causes[0];
            items.push({ type: 'disabled', label: src.dry ? '🏜️ Run dry: mud at the bottom' : `☠️ Foul${c ? ` with ${Water.causeWord(c.cause)}` : ''} — the water stinks` });
            if (!src.dry) items.push({ type: 'action', action: 'wm_anyway', label: 'Drink It Anyway', icon: '🤢', desc: 'It slakes you; it may give you the flux', q, r, def });
            const quote = src.settlement ? Water.cleanQuote(game.world, src.settlement) : null;
            if (quote) items.push({ type: 'action', action: 'wm_clean', label: 'Pay the Well-Diggers', icon: '🪣', desc: `${quote.price} gold: clean in ${quote.days} days`, q, r, def });
        } else {
            items.push({ type: 'action', action: 'wm_drink', label: 'Drink', icon: '💧', desc: `Thirst ${lvl}% — drink your fill`, q, r, def });
            if (room > 0) items.push({ type: 'action', action: 'wm_fill', label: 'Fill Your Waterskins', icon: '🎒', desc: `${room} draught${room === 1 ? '' : 's'} of room`, q, r, def });
            else if (Thirst.capacity(player) <= 0) items.push({ type: 'disabled', label: '🎒 No waterskin to fill' });
            // Fouling it is a crime against the town (systems/townCrimes.js)
            if (WELL_ONLY.has(def.id) && src.settlement && !src.own) {
                const can = TownCrimes.canPoisonWell(player, game.world, src.settlement);
                if (can.ok) items.push({ type: 'action', action: 'wm_foul', label: can.means.item === 'poison' ? 'Poison the Well' : 'Throw Carrion Down the Well', icon: '☠️', desc: `${can.means.label}: the town sickens. A crime if seen.`, q, r, def });
            }
        }
        return items;
    },

    /** A fresh water tile's entries (a river, a lake, a pond: never the sea). */
    waterItems(game, tile, q, r) {
        if (!tile || !tile._wet || tile._waterKind === 'sea' || !game || !game.player || !Thirst.on(game.player)) return [];
        if (/frozen|ice/.test((tile.subTerrain && tile.subTerrain.id) || '')) return [];
        const room = Thirst.capacity(game.player) - Thirst.held(game.player);
        const what = tile._waterKind === 'lake' ? 'the lake' : tile._waterKind === 'river' ? 'the river' : 'the water';
        const Title = what.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        const items = [{ type: 'action', action: 'wm_drink', label: `Drink from ${Title}`, icon: '💧', desc: `Thirst ${Thirst.level(game.player)}% — kneel at the bank and drink`, q, r, water: what }];
        if (room > 0) items.push({ type: 'action', action: 'wm_fill', label: 'Fill Your Waterskins', icon: '🎒', desc: `${room} draught${room === 1 ? '' : 's'} of room`, q, r, water: what });
        return items;
    },

    _reachThen(game, q, r, fn) {
        const how = InnerMap.approachAndThen(q, r, fn);
        if (how === 'unreachable') _note(game, '💧 Out of Reach', 'You can\'t get to it from here.', 'warning');
    },

    handle(game, item) {
        if (!item || !/^wm_/.test(item.action || '')) return false;
        const world = game && game.world, player = game && game.player;
        if (!world || !player) return true;
        const refresh = () => { if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, world); };
        const src = item.water ? { kind: 'river', label: item.water, foul: false, settlement: _town() } : InnerMapWater._source(game, item.def, item.q, item.r);
        InnerMapWater._reachThen(game, item.q, item.r, () => {
            let res;
            if (item.action === 'wm_drink') res = Thirst.drinkHere(player, world, { source: src });
            else if (item.action === 'wm_anyway') res = Thirst.drinkHere(player, world, { source: src, anyway: true });
            else if (item.action === 'wm_fill') res = Thirst.fillSkins(player, world, src);
            else if (item.action === 'wm_clean') res = src.settlement ? Water.clean(world, player, src.settlement) : { success: false, reason: 'There is no one here to pay.' };
            else if (item.action === 'wm_foul') {
                const s = src.settlement;
                res = s ? TownCrimes.poisonWell(player, world, s) : { success: false, reason: 'There is no town here.' };
                if (res.success) {
                    const ts = s.townCrimes && s.townCrimes.well;
                    Water.markHand(world, s, src.key, ts ? ts.until : (world.day || 0) + 8);
                }
            } else return;
            const title = item.action === 'wm_foul' ? '☠️ The Well' : item.action === 'wm_clean' ? '🪣 The Well-Diggers' : '💧 Water';
            _note(game, title, res.success ? res.text : res.reason, res.success ? (res.sick || res.seen ? 'warning' : 'success') : 'warning');
            refresh();
        });
        return true;
    },
};
