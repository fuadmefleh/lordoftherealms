// InnerMap — houses of hospitality on the inner map (systems/hospitality.js):
// the town's guest houses, inns and hotels take their names and keepers from
// world.hospitality, a roadhouse stands on the open road it serves, and the
// player's own houses open their lodging and management.
import { InnerMap } from './_ref.js';
import { Hospitality } from './_imports.js';

/** A hash stream for placements that must not draw on the generation RNG. */
function _rng(q, r, salt) {
    let s = (((q * 73856093) ^ (r * 19349663)) + salt) >>> 0 || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

Object.assign(InnerMap, {
    /**
     * Stand the NPC roadhouse of the road tile (q, r), if it has one, on its
     * inner map (called while the tiles are generated; draws nothing from
     * the generation RNG).
     */
    _placeRoadhouse(tiles, worldTile, worldQ, worldR, world) {
        if (!world || !worldTile || worldTile.settlement) return;
        const house = Hospitality.roadhouseAt(world, worldQ, worldR);
        if (!house) return;
        const pos = this._findSuitablePropertyTile(tiles, { type: 'roadhouse' }, _rng(worldQ, worldR, 4111));
        if (!pos) return;
        const height = tiles.length;
        const width = tiles[0] ? tiles[0].length : 0;
        for (let dq = -1; dq <= 1; dq++) {
            for (let dr = -2; dr <= 0; dr++) {
                const fq = pos.q + dq, fr = pos.r + dr;
                if (fr >= 0 && fr < height && fq >= 0 && fq < width) tiles[fr][fq].subTerrain.passable = false;
            }
        }
        const t = tiles[pos.r][pos.q];
        t.building = (this.PROPERTY_SPRITES.roadhouse || ['buildings/inn.png'])[0];
        t._buildingTypeHint = 'roadhouse';
        t._establishmentId = house.id;
    },

    /**
     * Tie the map's houses of hospitality to their houses: names, icons and
     * ids for the town's buildings in layout order, the roadhouse standing
     * on the road, and the player's own.
     */
    _bindHospitality(world) {
        if (!world || !this.currentWorldTile) return;
        const { q, r } = this.currentWorldTile;
        const worldTile = this._currentWorldTileRef;
        if (worldTile && worldTile.settlement) {
            const byKind = {};
            for (const h of Hospitality.townHouses(world, q, r)) (byKind[h.kind] = byKind[h.kind] || []).push(h);
            for (const b of this.buildings) {
                if (b.isPlayerProperty || !Hospitality.isKind(b.type)) continue;
                const h = byKind[b.type] && byKind[b.type].shift();
                if (!h) continue;
                b.name = h.name;
                b.establishmentId = h.id;
            }
        } else {
            const house = Hospitality.roadhouseAt(world, q, r);
            if (house && !this.buildings.some(b => b.establishmentId === house.id)) {
                for (let rr = 0; rr < this.height; rr++) {
                    const row = this.tiles[rr];
                    for (let qq = 0; qq < this.width; qq++) {
                        const t = row && row[qq];
                        if (!t || t._establishmentId !== house.id) continue;
                        const def = this.BUILDING_TYPES.roadhouse;
                        const bldg = {
                            q: qq, r: rr, type: 'roadhouse', name: house.name, icon: def.icon, sprite: t.building,
                            actions: [...def.actions], establishmentId: house.id,
                            ownerName: house.keeper, ownerTitle: (Hospitality.kind('roadhouse') || {}).keeperTitle || 'Keeper',
                        };
                        t.buildingInfo = bldg;
                        this.buildings.push(bldg);
                    }
                }
            }
        }
        for (const b of this.buildings) {
            const prop = b.isPlayerProperty && b.propertyRef;
            if (!prop || !Hospitality.isKind(prop.type)) continue;
            b.establishmentId = `p:${q},${r}:${prop.type}`;
            b.name = `${prop.name}${prop.underConstruction ? ' (Building)' : ''}`;
            b.isPlayerOwned = true;
            b.ownerName = 'you';
            b.ownerTitle = 'Owner';
        }
    },

    /**
     * Give each NPC house a keeper among the town's people — the same
     * townsperson every visit once bound (Hospitality.bindKeeper) — who keeps
     * to the house. `taken` holds the ids of NPCs already given a building.
     */
    _assignHospitalityKeepers(world, taken) {
        for (const b of this.buildings) {
            if (!b.establishmentId || b.isPlayerOwned) continue;
            const view = Hospitality.get(world, null, b.establishmentId);
            if (!view) continue;
            const free = n => !taken.has(n.id) && n.type !== 'child' && n.type !== 'traveler' && n.type !== 'beggar';
            const bound = Hospitality.state(world).houses[b.establishmentId].keeperUid;
            const keeper = (bound && this.npcs.find(n => n.uid === bound))
                || this.npcs.find(n => free(n) && (n.type === 'villager' || n.type === 'merchant'))
                || this.npcs.find(free);
            b.ownerTitle = view.keeperTitle;
            if (!keeper) {
                b.ownerName = view.keeper;
                continue;
            }
            taken.add(keeper.id);
            const name = keeper.fullName || keeper.name;
            if (keeper.uid) Hospitality.bindKeeper(world, b.establishmentId, keeper.uid, name);
            b.ownerId = keeper.id;
            b.ownerName = name;
            keeper.roleTitle = `${view.keeperTitle.toLowerCase()} of ${view.name}`;
            keeper.destinations = [b.type, b.type, 'marketplace'];
        }
    },

    /** The keeper of a roadhouse and a traveller or two, on an open-road map. */
    _spawnRoadhouseFolk(world) {
        const b = this.buildings.find(x => x.type === 'roadhouse' && x.establishmentId && !x.isPlayerOwned);
        if (!b) return;
        const view = Hospitality.get(world, null, b.establishmentId);
        const rng = _rng(b.q, b.r, 977);
        const keeper = this._makeNpc('villager', 0, rng);
        if (keeper) {
            const parts = String(view.keeper || 'the keeper').split(' ');
            keeper.name = parts[0];
            keeper.fullName = view.keeper;
            keeper.roleTitle = `${view.keeperTitle.toLowerCase()} of ${view.name}`;
            keeper.destinations = ['roadhouse'];
            this.npcs.push(keeper);
            b.ownerId = keeper.id;
        }
        const guests = Math.max(1, Math.min(3, view.guests || 1));
        for (let i = 0; i < guests; i++) {
            const t = this._makeNpc('traveler', this.npcs.length, rng);
            if (t) this.npcs.push(t);
        }
    },
});
