// ============================================
// InnerMap — town woodcutters: the town's own fellers at work on the map
// ============================================
// A share of the townsfolk are woodcutters by trade (systems/practiceSkills.js
// craftTrades: some villagers and farmers). In working hours (townLife.js 'work')
// one may walk out past the houses to a tree, stand at its trunk and fell it
// blow by blow, as the player does: the tree's health falls with each blow
// (the same customObject.currentHealthPct the player's blows wear down), and at
// the last it comes down the same way — its own stump left standing, the tree
// toppling away from the cutter, the felling kept with the map's others
// (felling.js _noteFelled) so the stump stands, sprouts and grows back. The
// cutter shoulders the logs and carries them to the town's yard (a warehouse,
// a sawmill, the market…), where they go into the town's goods.
//
// The renderer reads npc._chop for the swing (its phase: timer / interval) and
// InnerMap._chopEvents for each blow and felling (chips, the shudder, the knock:
// ui/innerMapFelling.js), and empties it.
//
// Data: data/townLife.json "woodcutting". Draws only from Utils (seedable).

import { InnerMap } from './_ref.js';
import { Utils, CustomObjects, Townsfolk, PracticeSkills } from './_imports.js';

const DEFAULTS = {
    share: 0.7,          // at work, the chance a woodcutter goes out to fell instead
    maxPerDay: 3,        // trees the town's cutters fell on one map in a day
    reach: 40,           // how far from home a cutter goes for a tree (tiles)
    townClear: 2,        // trees within this of the town's houses are left (gardens, the green)
    blow: 12,            // % of a tree's health a blow takes, less its hardness (fell.hardness %)
    interval: 0.8,       // seconds between blows
    carryMax: 20,        // logs carried in at once
    goodsPerWood: 0.1,   // town goods a log brings
    stores: ['sawmill', 'carpenter', 'warehouse', 'lumber_yard', 'marketplace', 'blacksmith', 'barn'],
};

const _key = (q, r) => `${q},${r}`;

Object.assign(InnerMap, {
    /** Blows and fellings by the town's cutters since the renderer last looked: [{ kind: 'hit' | 'felled', q, r, defId, cutterQ, cutterR }]. */
    _chopEvents: [],

    townWoodConfig() {
        const d = (this.townLifeConfig().woodcutting) || {};
        return { ...DEFAULTS, ...d };
    },

    /** Is this townsperson a woodcutter by trade? (their person's craft, settled once) */
    _isTownWoodcutter(npc) {
        if (!npc) return false;
        if (npc._woodcutter === undefined) {
            let wood = false;
            if (npc._person && npc._folk && Townsfolk.skillWho && PracticeSkills.craftOf) {
                const who = Townsfolk.skillWho(npc._folk, npc._person, this.worldDay || 1, false, false);
                wood = PracticeSkills.craftOf(who) === 'woodcutter';
            }
            npc._woodcutter = wood;
        }
        return npc._woodcutter;
    },

    /** Trees the town's cutters have felled on this map today. */
    _townFelledToday() {
        const rec = this._fellRec;
        if (!rec) return 0;
        const day = this._fellDay();
        return Object.values(rec).filter(f => f && f.by === 'town' && f.day === day && !f.grubbed).length;
    },

    /** A tree to fell, out beyond the houses and near enough home: the anchor and def, or null. */
    _pickTownTree(npc) {
        const C = this.townWoodConfig();
        const rnd = Utils.random;
        const base = npc._home || npc;
        const m = (this.townArea() || {}).margin || 8;
        const claimed = new Set((this.npcs || []).filter(o => o !== npc && o._chop).map(o => _key(o._chop.q, o._chop.r)));
        const ia = this._activeInteraction;
        if (ia && !ia.done) claimed.add(_key(ia.anchorQ, ia.anchorR));
        const found = [];
        const R = Math.max(4, C.reach | 0);
        for (let r = Math.max(m, base.r - R); r <= Math.min(this.height - m - 1, base.r + R); r++) {
            const row = this.tiles[r];
            if (!row) continue;
            for (let q = Math.max(m, base.q - R); q <= Math.min(this.width - m - 1, base.q + R); q++) {
                const t = row[q];
                const obj = t && t.customObject;
                if (!obj || t._isInterior || claimed.has(_key(q, r))) continue;
                const def = CustomObjects.getDef(obj.defId);
                if (!def || !def.topples || /sapling/.test(def.id)) continue;
                const trunk = this.trunkOf(q, r, def);
                if (this._nearTown(trunk.q, trunk.r, C.townClear)) continue;
                found.push({ q, r, def, trunk, d: Math.hypot(trunk.q - base.q, trunk.r - base.r) });
            }
        }
        if (!found.length) return null;
        found.sort((a, b) => a.d - b.d);
        const near = found.slice(0, 5);
        return near[Math.floor(rnd() * near.length)];
    },

    /** Within `pad` tiles of the town (its streets and lots)? */
    _nearTown(q, r, pad) {
        for (let dr = -pad; dr <= pad; dr++) for (let dq = -pad; dq <= pad; dq++) if (this.inTown(q + dq, r + dr)) return true;
        return false;
    },

    /** Off to fell a tree: stand at its trunk's side (else below it), facing it. False if none will do. */
    _goToTree(npc) {
        const C = this.townWoodConfig();
        if (this._townFelledToday() >= C.maxPerDay) return false;
        const tree = this._pickTownTree(npc);
        if (!tree) return false;
        const { trunk } = tree;
        const busy = (q, r) => (this.npcs || []).some(o => o !== npc && o.q === q && o.r === r);
        let spot = null;
        for (const [dq, dr] of [[-1, 0], [1, 0], [0, 1]]) {
            const t = this.getTile(trunk.q + dq, trunk.r + dr);
            if (!t || !t.subTerrain || !t.subTerrain.passable || t.customObject || t.customObjectPart || t.building || t.isWater || busy(t.q, t.r)) continue;
            spot = { q: trunk.q + dq, r: trunk.r + dr };
            break;
        }
        if (!spot) return false;
        const face = spot.q < trunk.q ? 3 : spot.q > trunk.q ? 1 : 0;
        npc._chop = { q: tree.q, r: tree.r, defId: tree.def.id, timer: 0, interval: C.interval, going: true };
        if (this._goStand(npc, spot, 'chop', face)) return true;
        npc._chop = null;
        return false;
    },

    /** At the trunk: to work, axe in hand. */
    _startChopping(npc) {
        const ch = npc._chop;
        const t = ch && this.getTile(ch.q, ch.r);
        if (!t || !t.customObject || t.customObject.defId !== ch.defId) { npc._chop = null; return; }
        ch.going = false;
        ch.timer = 0;
        if (t.customObject.currentHealthPct == null) t.customObject.currentHealthPct = 100;
        npc.activity = { type: 'chop', icon: '🌲', label: 'Felling a tree', anim: 'slash' };
        npc.idleTimer = 600;          // (till the tree is down: _updateTownChopping lets them go)
    },

    /** Called away (or the tree is gone): put the axe down. */
    _stopChopping(npc) {
        npc._chop = null;
        if (npc.activity && npc.activity.type === 'chop') npc.activity = null;
    },

    /** Each frame: the cutters at their trees swing, and the trees come down. */
    _updateTownChopping(dt) {
        const C = this.townWoodConfig();
        for (const npc of this.npcs || []) {
            const ch = npc._chop;
            if (!ch || ch.going) continue;
            if (npc.state !== 'idle' || npc._dialogFrozen) { if (npc.state !== 'idle' && npc.state !== 'dialog') this._stopChopping(npc); continue; }
            const t = this.getTile(ch.q, ch.r);
            const obj = t && t.customObject;
            if (!obj || obj.defId !== ch.defId) { this._stopChopping(npc); npc.idleTimer = Math.min(npc.idleTimer, 1); continue; }
            ch.timer += Math.max(0, dt || 0);
            if (ch.timer < ch.interval) continue;
            ch.timer -= ch.interval;
            const def = CustomObjects.getDef(ch.defId);
            const hard = Math.max(0, Math.min(90, Number(def && def.resistance) || 0));   // (its fell.hardness)
            const dmg = C.blow * (1 - hard / 100) * (0.875 + Utils.random() * 0.25);
            obj.currentHealthPct = Math.max(0, (obj.currentHealthPct == null ? 100 : obj.currentHealthPct) - dmg);
            this._chopEvents.push({ kind: 'hit', q: ch.q, r: ch.r, defId: ch.defId, cutterQ: npc.q, cutterR: npc.r });
            if (obj.currentHealthPct > 0) continue;
            this._townFell(npc, t, def);
        }
    },

    /** The last blow: the tree comes down, its stump stays, the cutter shoulders the logs. */
    _townFell(npc, tile, def) {
        const ch = npc._chop;
        const res = tile.customObject.resource || (def && def.resource) || null;
        this._removeCustomObject(ch.q, ch.r);
        const after = tile.customObject;
        const stumpId = after && def && after.defId === def.spawnAfter ? after.defId : null;
        if (this._noteFelled) this._noteFelled(ch.q, ch.r, def, stumpId, npc.q, 'town');
        this._chopEvents.push({ kind: 'felled', q: ch.q, r: ch.r, defId: ch.defId, cutterQ: npc.q, cutterR: npc.r });
        const C = this.townWoodConfig();
        const logs = Math.min(C.carryMax, Math.max(1, Math.round((res && res.amount) || 10)));
        if (res && res.type === 'wood') npc._carry = { good: 'wood', qty: logs };
        this._stopChopping(npc);
        npc.idleTimer = 1.5;          // (they watch it fall, then shoulder the logs)
    },

    /** Gone indoors at the yard with logs: they go into the town's goods. */
    _townWoodDelivered(npc, bldg) {
        const c = npc._carry;
        if (!c || c.good !== 'wood' || !bldg) return false;
        const C = this.townWoodConfig();
        if (!(C.stores || []).includes(bldg.type)) return false;
        npc._carry = null;
        const ref = this._currentWorldTileRef;
        const econ = ref && ref.settlement && ref.settlement.economy;
        if (econ) econ.goods = (Number(econ.goods) || 0) + c.qty * (Number(C.goodsPerWood) || 0);
        return true;
    },
});
