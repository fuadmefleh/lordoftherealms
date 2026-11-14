// InnerMap — climbing: the player may go up and down the rock faces of the
// crags (world/innerMap/cliffs.js) instead of walking round. Only the player:
// townsfolk, crew and beasts keep to the ground (their paths never ask to
// climb, and a crag stays impassable to them).
//
//   • standLevel(tile): how high you stand on a tile — 0 on the ground, the
//     crag's level on its top (1, or 2 on a second step up), null on a rock
//     face (nobody stands on a face).
//   • playerLevel(): the height of the tile the player stands on. The player
//     walks only among tiles of their own height (_playerMayEnter): on a
//     crag's top they keep to its top until they climb down.
//   • climbLinks(): every climbable face, found once per map — a column of
//     face tiles with ground (or a lower top) at its foot and a top above:
//     { fromQ, fromR, toQ, toR, rows, up, fromLevel, toLevel } both ways.
//     linksFrom(q, r), linkBetween(a, b).
//   • _climbMax: the tallest face (in rows) the player can climb now, set
//     each frame by the game loop from the Climbing skill (player/climbing.js,
//     ui/innerMapClimbing.js); 0 = no climbing. The player's paths may take a
//     face no taller (each row counted as climbPathCost steps): a step of the
//     path that jumps from a face's foot to its top (or back) is a climb.
//   • _climb: the climb under way ({ link, elapsed, duration, slipAt }),
//     driven by ui/innerMapClimbing.js; getPlayerWorldPos draws the player
//     on the rock between its ends, and updatePlayer waits for it.
//   • climbTargetFor(q, r): a click on a face goes to its other end from you.
//
// No randomness here: whether a climb goes well is player/climbing.js.

import { InnerMap } from './_ref.js';

const T = 32;

Object.assign(InnerMap, {
    _climbMax: 0,
    _climbPathCost: 5,
    _climb: null,
    _climbRequest: null,

    /** How high one stands on this tile: 0 ground, a crag's top its level, null on a face. */
    standLevel(tile) {
        if (!tile || !tile.subTerrain) return null;
        if (tile.subTerrain.id !== 'cliff') return 0;
        return tile._cragTop ? Math.max(1, tile._cragLevel || 1) : null;
    },

    /** The height the player stands at */
    playerLevel() {
        const t = this.tiles && this.tiles[this.playerInnerR] && this.tiles[this.playerInnerR][this.playerInnerQ];
        const lv = this.standLevel(t);
        return lv == null ? 0 : lv;
    },

    /** Is the player up on a crag? */
    isPlayerOnCrag() {
        return this.playerLevel() > 0;
    },

    /** Is this a rock face tile? */
    isCliffFace(tile) {
        return !!(tile && tile.subTerrain && tile.subTerrain.id === 'cliff' && !tile._cragTop);
    },

    /** Every climbable face on this map, keyed by the tile it starts from ("q,r" → [link]). */
    climbLinks() {
        const tiles = this.tiles;
        if (!tiles || !tiles.length) return new Map();
        if (this._climbLinkCache && this._climbLinkCache.tiles === tiles) return this._climbLinkCache.map;
        const map = new Map();
        const add = (l) => {
            const k = `${l.fromQ},${l.fromR}`;
            if (!map.has(k)) map.set(k, []);
            map.get(k).push(l);
        };
        const H = tiles.length, W = tiles[0].length;
        for (let q = 0; q < W; q++) {
            let r = 0;
            while (r < H) {
                if (!this.isCliffFace(tiles[r][q])) { r++; continue; }
                const rTop = r;
                while (r < H && this.isCliffFace(tiles[r][q])) r++;
                const rBot = r - 1;
                // (a cave's mouth or a drift cut into the face: no way up the rock there — world/innerMap/mines.js)
                let holed = false;
                for (let y = rTop; y <= rBot && !holed; y++) holed = !!(tiles[y][q]._caveMouthOf || tiles[y][q]._adit);
                if (holed) continue;
                const top = rTop > 0 ? tiles[rTop - 1][q] : null;
                const foot = r < H ? tiles[r][q] : null;
                const toLevel = this.standLevel(top), fromLevel = this.standLevel(foot);
                if (!top || !foot || toLevel == null || fromLevel == null || toLevel <= fromLevel) continue;
                // the foot must be ground one could stand on (not water, a wall, a house)
                if (fromLevel === 0 && !foot.subTerrain.passable) continue;
                if (foot.building || foot.customObject || foot.customObjectPart || foot.customBuilding || foot.customBuildingPart) continue;
                const rows = rBot - rTop + 1;
                add({ fromQ: q, fromR: rBot + 1, toQ: q, toR: rTop - 1, rows, up: true, fromLevel, toLevel });
                add({ fromQ: q, fromR: rTop - 1, toQ: q, toR: rBot + 1, rows, up: false, fromLevel: toLevel, toLevel: fromLevel });
            }
        }
        this._climbLinkCache = { tiles, map };
        return map;
    },

    /** The faces one could climb from (q, r) */
    linksFrom(q, r) {
        return this.climbLinks().get(`${q},${r}`) || [];
    },

    /** The climb from (aq, ar) to (bq, br), or null */
    linkBetween(aq, ar, bq, br) {
        return this.linksFrom(aq, ar).find(l => l.toQ === bq && l.toR === br) || null;
    },

    /** The faces the player could climb from where they stand */
    playerClimbs() {
        return this.linksFrom(this.playerInnerQ, this.playerInnerR);
    },

    /**
     * Where a click at (q, r) should take a climber: a face → its far end
     * from the player's height (the top from below, the foot from above);
     * anything else as it is. null when nothing climbable is there.
     */
    climbTargetFor(q, r) {
        const t = this.getTile(q, r);
        if (!this.isCliffFace(t)) return { q, r };
        // the column's face: walk down to its foot and up to its top
        let r0 = r, r1 = r;
        while (this.isCliffFace(this.getTile(q, r0 - 1))) r0--;
        while (this.isCliffFace(this.getTile(q, r1 + 1))) r1++;
        const up = this.linkBetween(q, r1 + 1, q, r0 - 1);
        if (!up) return null;
        return this.playerLevel() >= up.toLevel ? { q, r: r1 + 1 } : { q, r: r0 - 1 };
    },

    /**
     * The climb is over: the player stands at (q, r) — the far end, or the
     * foot after a fall (which ends the walk). A walk that climbed goes on.
     */
    finishClimb(q, r, fell = false) {
        this._climb = null;
        this._climbRequest = null;
        this._playerPrevQ = q;
        this._playerPrevR = r;
        this.playerInnerQ = q;
        this.playerInnerR = r;
        if (this.tiles) this._revealAround(this.tiles, q, r, 2);
        if (fell || !this._playerPath) {
            this.cancelPlayerWalk();
            return;
        }
        this._playerPathIndex++;
        this._playerMoveProgress = 0;
        if (this._playerPathIndex >= this._playerPath.length) {
            this._playerWalking = false;
            this._playerPath = null;
        }
    },

    /** Drop a climb (the map changed under it): back where it began. */
    abandonClimb() {
        this._climb = null;
        this._climbRequest = null;
    },

    /** The player's position on the rock while climbing (world px), or null */
    _climbPos() {
        const c = this._climb;
        if (!c) return null;
        const l = c.link;
        const share = Math.max(0, Math.min(1, c.elapsed / Math.max(0.01, c.duration)));
        const fx = l.fromQ * T + T / 2, fy = l.fromR * T + T / 2;
        const tx = l.toQ * T + T / 2, ty = l.toR * T + T / 2;
        if (c.falling) {
            // dropping from where they slipped to the foot
            const foot = l.up ? { x: fx, y: fy } : { x: tx, y: ty };
            const k = Math.min(1, c.fallT / Math.max(0.01, c.fallDuration));
            return { x: c.slipX + (foot.x - c.slipX) * k * k, y: c.slipY + (foot.y - c.slipY) * k * k };
        }
        return { x: fx + (tx - fx) * share, y: fy + (ty - fy) * share };
    },
});
