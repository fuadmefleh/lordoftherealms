// InnerMap — a clan's camp at the Dawn of Man (world/dawn.js).
//
// A wandering clan has no village to walk into, but where it stops it makes
// camp: hide tents round a campfire, woodpiles by them, and its people about
// the fire. Clans move, and the inner map of a hex is cached, so the camp is
// pitched when the player enters (enter → _pitchCamps) and struck when they
// come back after the clan has gone (a cold fire ring stays). The player's
// own family are among the clan folk by name (player.dawnKin).
//
// Placements draw on a hash stream of the hex and the clan, never on the
// generation RNG, so pitching a camp leaves the map's own layout untouched.

import { InnerMap } from './_ref.js';
import { CustomObjects, Utils } from './_imports.js';
import { TownProps } from '../townProps.js';

function _rng(seedA, seedB, salt) {
    let s = (((seedA * 73856093) ^ (seedB * 19349663)) + salt) >>> 0 || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

// A colony founded in play is a camp of tents until it has this many souls
const CAMP_OUTGROWN = 150;

const _hashStr = (str) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
    return h >>> 0;
};

Object.assign(InnerMap, {
    /** The clans standing on world hex (q, r) */
    _clansAt(world, q, r) {
        if (!world || !Array.isArray(world.units)) return [];
        return world.units.filter(u => u && u.type === 'clan' && !u.destroyed && u.q === q && u.r === r);
    },

    /**
     * Pitch the camp of each clan on this hex (or strike a camp whose clan
     * has moved on). Called by enter() on a hex without a settlement.
     * Returns the camps pitched: [{ clan, hub: {q, r}, tents }].
     */
    _pitchCamps(game) {
        const world = game && game.world;
        const tiles = this.tiles;
        if (!world || !tiles || !this.currentWorldTile) return [];
        const { q: wq, r: wr } = this.currentWorldTile;
        const clans = this._clansAt(world, wq, wr);
        const existing = this._campRecord(tiles);
        const pitched = [];

        // The clan that camped here has gone: strike the tents, leave the fire ring
        if (existing && !clans.some(c => c.id === existing.clanId)) {
            this._strikeCamp(tiles, existing);
            const ht = tiles[existing.hub.r] && tiles[existing.hub.r][existing.hub.q];
            if (ht) ht._camp = null;
        }
        const clan = clans[0];
        if (!clan) return pitched;
        // (First Steps at the dawn: you have walked into your own people's camp)
        if (game.player && game.player.dawnClan === clan.id) game.player.dawnCampVisited = true;
        const mine = existing && existing.clanId === clan.id ? existing : null;
        if (mine) {
            if (this._revealAround) this._revealAround(tiles, mine.hub.q, mine.hub.r, 10);
            pitched.push({ clan, hub: mine.hub, tents: mine.tents });
            this._spawnClanFolk(game, clan, mine.hub);
            return pitched;
        }
        const camp = this._layCamp(tiles, clan);
        if (!camp) return pitched;
        // (kept on the hub tile, so it survives a save with the map)
        tiles[camp.hub.r][camp.hub.q]._camp = camp;
        // You know your own people's camp (and anyone's you walk into): all of it in sight
        if (this._revealAround) this._revealAround(tiles, camp.hub.q, camp.hub.r, 10);
        pitched.push({ clan, hub: camp.hub, tents: camp.tents });
        this._spawnClanFolk(game, clan, camp.hub);
        return pitched;
    },

    /** The camp record on this map (on its fire's tile), or null */
    _campRecord(tiles) {
        for (const row of tiles) for (const t of row) if (t && t._camp) return t._camp;
        return null;
    },

    /** Clear the ground, light the fire, put the tents up round it. → camp record or null */
    _layCamp(tiles, clan) {
        const H = tiles.length, W = tiles[0].length;
        const rng = _rng(_hashStr(String(clan.id)), clan.population || 1, 5501);
        const cq = Math.floor(W / 2), cr = Math.floor(H / 2);
        // The fire a few steps off where the player comes in, on dry ground
        let hub = null;
        for (let tries = 0; tries < 40 && !hub; tries++) {
            // (close by, so the camp is the first thing you see coming in)
            const q = cq + Math.round((rng() - 0.5) * 4) + (tries < 20 ? 3 : 0);
            const r = cr + Math.round((rng() - 0.5) * 4) - (tries < 20 ? 2 : 0);
            const t = tiles[r] && tiles[r][q];
            if (!t || (t.subTerrain && /water/.test(t.subTerrain.id || ''))) continue;
            if (t.building || t.customBuilding || t.customBuildingPart) continue;
            // (an old fire ring, a house the player built: not on top of them)
            if ((t.customObject && t.customObject.planted) || t.customObjectPart) continue;
            hub = { q, r };
        }
        if (!hub) return null;

        const cleared = this._clearGround(tiles, hub, 8);
        const placed = [];
        const put = (id, q, r) => {
            const def = CustomObjects.getDef(id);
            if (!def || !TownProps.place(tiles, def, q, r)) return false;
            placed.push({ q, r, id });
            return true;
        };
        put('tp_campfire', hub.q, hub.r);

        // Tents in a ring, doors toward the fire (the sprites face south: the
        // ring sits mostly north, east and west of the fire, a few south)
        const want = Math.max(2, Math.min(6, Math.round((clan.population || 30) / 12)));
        const tentIds = ['tp_tent_hide', 'tp_tent_fell'];
        let tents = 0;
        const start = rng() * Math.PI * 2;
        for (let i = 0; i < want * 4 && tents < want; i++) {
            const a = start + (i / want) * Math.PI * 2 + (rng() - 0.5) * 0.5;
            const dist = 4.5 + rng() * 2.5;
            // anchor is the bottom-left cell of a 3x3 tent: centre it on the ring point
            const q = Math.round(hub.q + Math.cos(a) * dist * 1.2) - 1;
            const r = Math.round(hub.r + Math.sin(a) * dist * 0.9) + 1;
            if (put(tentIds[(tents + (rng() < 0.3 ? 1 : 0)) % 2], q, r)) tents++;
        }
        // Firewood by the hearth, logs at the edge of camp
        for (const [id, dq, dr] of [['tp_firewood', 2, 1], ['tp_logs', -3, 2], ['tp_firewood', -2, -1]]) {
            put(id, hub.q + dq, hub.r + dr);
        }
        return { clanId: clan.id, clanName: clan.clanName || clan.name, hub, tents, placed, cleared };
    },

    /**
     * Take the trees and brush off the camp ground (radius `rad` round
     * `hub`): objects whose anchor stands there go, with all their cells.
     * Returns how many were cleared.
     */
    _clearGround(tiles, hub, rad) {
        const H = tiles.length, W = tiles[0].length;
        const gone = new Set();
        for (let r = Math.max(0, hub.r - rad); r <= Math.min(H - 1, hub.r + rad); r++) {
            for (let q = Math.max(0, hub.q - rad); q <= Math.min(W - 1, hub.q + rad); q++) {
                const dq = (q - hub.q) / 1.2, dr = r - hub.r;
                if (dq * dq + dr * dr > rad * rad) continue;
                const t = tiles[r][q];
                if (t.customObject && !t.customObject.planted) { gone.add(`${q},${r}`); t.customObject = null; }
                if (t.customObjectPart && !gone.has(`${t.customObjectPart.anchorQ},${t.customObjectPart.anchorR}`)) {
                    const a = t.customObjectPart;
                    const at = tiles[a.anchorR] && tiles[a.anchorR][a.anchorQ];
                    if (at && at.customObject && !at.customObject.planted) { gone.add(`${a.anchorQ},${a.anchorR}`); at.customObject = null; }
                }
            }
        }
        if (!gone.size) return 0;
        // Free every cell that belonged to a cleared object
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                const t = tiles[r][q];
                const part = t.customObjectPart;
                if (gone.has(`${q},${r}`) || (part && gone.has(`${part.anchorQ},${part.anchorR}`))) {
                    t.customObjectPart = null;
                    if (t.subTerrain && !/water/.test(t.subTerrain.id || '')) t.subTerrain.passable = true;
                }
            }
        }
        return gone.size;
    },

    /** The clan has moved on: its tents and woodpiles go; a cold fire ring is left */
    _strikeCamp(tiles, camp) {
        for (const p of camp.placed || []) {
            const t = tiles[p.r] && tiles[p.r][p.q];
            if (!t || !t.customObject || t.customObject.defId !== p.id) continue;
            const def = CustomObjects.getDef(p.id);
            t.customObject = null;
            for (const m of [...((def && def.meta) || []), ...((def && def.tiles) || [])]) {
                const c = tiles[p.r + m.localRow] && tiles[p.r + m.localRow][p.q + m.localCol];
                if (!c) continue;
                c.customObjectPart = null;
                if (c.subTerrain && !/water/.test(c.subTerrain.id || '')) c.subTerrain.passable = true;
            }
        }
        const cold = CustomObjects.getDef('tp_campfire_out');
        if (cold && camp.hub) TownProps.place(tiles, cold, camp.hub.q, camp.hub.r);
    },

    /**
     * The clan's people about the fire: the player's own family by name
     * (from the player's relationship roster, player.dawnKin), then clan
     * folk up to a number that fits the clan's size.
     */
    _spawnClanFolk(game, clan, hub) {
        const player = game && game.player;
        const rng = _rng(_hashStr(String(clan.id)), (game.world && game.world.day) || 0, 7717);
        const near = () => {
            for (let i = 0; i < 30; i++) {
                const q = hub.q + Math.round((rng() - 0.5) * 9);
                const r = hub.r + Math.round((rng() - 0.5) * 7);
                const t = this.tiles[r] && this.tiles[r][q];
                if (t && t.subTerrain && t.subTerrain.passable && !t.customObject && !t.customObjectPart) return { q, r };
            }
            return { q: hub.q + 1, r: hub.r + 1 };
        };
        const place = (npc) => {
            const p = near();
            npc.q = npc.targetQ = npc.prevQ = p.q;
            npc.r = npc.targetR = npc.prevR = p.r;
            npc.campHub = { q: hub.q, r: hub.r };
            npc.destinations = [];
            npc.clanName = clan.clanName || clan.name;
        };

        const kin = [];
        if (player && player.dawnClan === clan.id && Array.isArray(player.dawnKin)) {
            const roster = Array.isArray(player._relationshipNpcs) ? player._relationshipNpcs : [];
            for (const id of player.dawnKin) {
                const k = roster.find(n => n && n.id === id && n.isAlive !== false);
                if (k) kin.push(k);
            }
        }
        for (const k of kin) {
            const npc = this._makeNpc('villager', this.npcs.length, rng);
            if (!npc) continue;
            npc.name = k.firstName;
            npc.fullName = `${k.firstName} of the ${clan.clanName || 'clan'}`;
            npc.roleTitle = `your ${k.kin}`;
            npc.relationshipNpcId = k.id;
            npc.isKin = true;
            if (k.gender) npc.gender = k.gender;
            // They greet you as the kin they are: their regard for you (player/dawnBirth.js) is their mood in talk
            const rel = player.relationships && player.relationships[k.id];
            const regard = rel && Number.isFinite(rel.score) ? rel.score : 60;
            npc._dialogMemory = {
                timesSpoken: 0, disposition: Math.max(0, Math.min(100, Math.round(regard))), lastAction: null, giftsReceived: 0,
                threatened: false, flattered: false, questOffered: false, rumorsTold: 0, playerTitle: null, kin: k.kin,
            };
            place(npc);
            this.npcs.push(npc);
        }
        const folk = Math.max(2, Math.min(8, Math.round((clan.population || 30) / 8))) - kin.length;
        const roles = ['hunter', 'gatherer', 'fire-keeper', 'toolmaker', 'elder', 'herder'];
        for (let i = 0; i < folk; i++) {
            const npc = this._makeNpc('villager', this.npcs.length, rng);
            if (!npc) continue;
            npc.roleTitle = `${roles[Math.floor(rng() * roles.length)]} of the ${clan.clanName || 'clan'}`;
            place(npc);
            this.npcs.push(npc);
        }
    },

    /** A walk for someone of the camp: somewhere round the fire */
    _campDestination(npc) {
        const hub = npc.campHub;
        for (let i = 0; i < 15; i++) {
            const q = hub.q + Math.round((Utils.random() - 0.5) * 12);
            const r = hub.r + Math.round((Utils.random() - 0.5) * 9);
            const t = this.tiles[r] && this.tiles[r][q];
            if (t && t.subTerrain && t.subTerrain.passable) return { q, r };
        }
        return null;
    },
});

Object.assign(InnerMap, {
    /**
     * A village of the Dawn of Man (a dawn-born settlement still a village):
     * no streets of stone, no glazed windows — a great fire at its heart,
     * rings of tents (more the more people), cook fires and woodpiles, and
     * trodden paths out to the land beyond. Called by generate() in place of
     * the town planner. Returns a layout like SettlementGenerator's.
     */
    _layVillageCamp(tiles, settlement, worldQ, worldR) {
        const H = tiles.length, W = tiles[0].length;
        const rng = _rng(worldQ, worldR, 9091 + _hashStr(String(settlement.name || '')));
        const hub = { q: Math.floor(W / 2) + 3, r: Math.floor(H / 2) - 2 };
        const pop = Math.max(30, settlement.population || 100);
        this._clearGround(tiles, hub, 16);
        const roadTiles = [];
        const mark = (q, r) => {
            const t = tiles[r] && tiles[r][q];
            if (!t || t.isRoad || (t.subTerrain && /water/.test(t.subTerrain.id || ''))) return;
            t.isRoad = true;
            t.subTerrain.passable = true;
            t.baseTerrain = 'dirt';
            t.subTerrain.id = 'dirt';
            t.subTerrain.name = 'Trodden path';
            t.subTerrain.color = '#8b7355';
            roadTiles.push({ q, r });
        };
        // Paths out of the village in four directions, wandering as feet do
        for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            let q = hub.q + dq * 2, r = hub.r + dr * 2;
            while (q > 0 && r > 0 && q < W - 1 && r < H - 1) {
                mark(q, r);
                if (rng() < 0.18) { if (dq) r += rng() < 0.5 ? -1 : 1; else q += rng() < 0.5 ? -1 : 1; mark(q, r); }
                q += dq; r += dr;
            }
        }
        // A trodden ring round the great fire
        for (let a = 0; a < Math.PI * 2; a += 0.12) mark(Math.round(hub.q + Math.cos(a) * 3.6), Math.round(hub.r + Math.sin(a) * 2.8));

        const put = (id, q, r) => {
            const def = CustomObjects.getDef(id);
            return !!def && TownProps.place(tiles, def, q, r, { onRoad: false });
        };
        put('tp_campfire', hub.q, hub.r);
        tiles[hub.r][hub.q]._villageHub = true;
        // Tents in rings: about one to every dozen people
        const want = Math.max(4, Math.min(18, Math.round(pop / 12)));
        const tentIds = ['tp_tent_hide', 'tp_tent_fell'];
        let tents = 0;
        for (const [radius, share] of [[6.5, 0.45], [10.5, 0.4], [14, 0.3]]) {
            const ring = Math.round(want * share) + 1;
            const start = rng() * Math.PI * 2;
            for (let i = 0; i < ring * 3 && tents < want; i++) {
                const a = start + (i / ring) * Math.PI * 2 + (rng() - 0.5) * 0.3;
                const q = Math.round(hub.q + Math.cos(a) * radius * 1.25) - 1;
                const r = Math.round(hub.r + Math.sin(a) * radius * 0.9) + 1;
                if (put(tentIds[Math.floor(rng() * 2)], q, r)) tents++;
            }
        }
        // Cook fires and woodpiles between the tents
        const fires = Math.max(1, Math.round(pop / 80));
        for (let i = 0, n = 0; i < fires * 12 && n < fires; i++) {
            const a = rng() * Math.PI * 2, d = 8 + rng() * 5;
            if (put('tp_campfire', Math.round(hub.q + Math.cos(a) * d * 1.2), Math.round(hub.r + Math.sin(a) * d * 0.9))) n++;
        }
        for (let i = 0, n = 0; i < 30 && n < Math.max(2, fires + 1); i++) {
            const a = rng() * Math.PI * 2, d = 4 + rng() * 9;
            if (put(rng() < 0.5 ? 'tp_firewood' : 'tp_logs', Math.round(hub.q + Math.cos(a) * d * 1.2), Math.round(hub.r + Math.sin(a) * d * 0.9))) n++;
        }
        return { roadTiles, buildings: 0, blocks: [], lots: [], camp: { hub, tents } };
    },

    /** The great fire of a dawn village's map, or null */
    _villageHub(tiles) {
        for (let r = 0; r < tiles.length; r++) for (let q = 0; q < tiles[r].length; q++) if (tiles[r][q] && tiles[r][q]._villageHub) return { q, r };
        return null;
    },

    /** Is this a village still in its dawn (tents, not streets)? */
    // (also a colony freshly founded in play: its settlers make camp first —
    // no streets, no churchyard — and it's laid out as a village once it has
    // grown to CAMP_OUTGROWN souls; once outgrown it never goes back to tents)
    _isDawnVillage(settlement) {
        if (!settlement || settlement.type !== 'village') return false;
        if (settlement.dawnBorn) return true;
        if (!settlement.colony || settlement.campOutgrown) return false;
        if ((Number(settlement.population) || 0) >= CAMP_OUTGROWN) {
            settlement.campOutgrown = true;
            return false;
        }
        return true;
    },
});
