// ============================================
// InnerMap — town miners: the town's own quarrymen at work on the map
// ============================================
// A share of the townsfolk are miners by trade (systems/practiceSkills.js:
// craftTrades — a few villagers anywhere — and, in the hills and mountains,
// mountainTrades). In working hours (townLife.js 'work') one may walk out past
// the houses to a boulder or a heap of stones, stand at it and break it up with
// a pick, blow by blow, as the player does (the same customObject.currentHealthPct
// the player's blows wear down; the swing and the stone chips are the woodcutters'
// machinery, townWoodcutters.js, with the pick in hand). When it gives, the rock is
// gone and the miner carries the stone to the town's mason, quarry or yard, where
// it goes into the town's goods. A few rocks a day on a map at most.
//
// Data: data/townLife.json "mining". Draws only from Utils (seedable).

import { InnerMap } from './_ref.js';
import { Utils, CustomObjects, Townsfolk, PracticeSkills } from './_imports.js';

const DEFAULTS = {
    share: 0.7,          // at work, the chance a miner goes out to break stone instead
    maxPerDay: 4,        // rocks the town's miners break on one map in a day
    reach: 40,           // how far from home a miner goes for a rock (tiles)
    townClear: 2,        // rocks within this of the town are left
    blow: 14,            // % of a rock's health a blow takes, less its resistance %
    interval: 0.9,       // seconds between blows
    carryMax: 12,        // stone carried in at once
    goodsPerStone: 0.08, // town goods a stone brings
    stores: ['mason', 'quarry', 'stonemason', 'warehouse', 'blacksmith', 'marketplace', 'barn'],
};

Object.assign(InnerMap, {
    townMineConfig() {
        const d = (this.townLifeConfig().mining) || {};
        return { ...DEFAULTS, ...d };
    },

    /** Is this townsperson a miner by trade? (their person's craft, or a hill trade; settled once) */
    _isTownMiner(npc) {
        if (!npc) return false;
        if (npc._miner === undefined) {
            let miner = false;
            if (npc._person && npc._folk && Townsfolk.skillWho && PracticeSkills.craftOf) {
                const w = this._fellWorld || null;
                const f = npc._folk;
                const mountain = !!(w && PracticeSkills.mountainAt && PracticeSkills.mountainAt(w, f.q, f.r));
                const who = Townsfolk.skillWho(f, npc._person, this.worldDay || 1, false, mountain);
                miner = PracticeSkills.craftOf(who) === 'miner'
                    || !!(PracticeSkills.bodyTradesOf && PracticeSkills.bodyTradesOf(who).includes('miner'));
            }
            npc._miner = miner;
        }
        return npc._miner;
    },

    /** Rocks the town's miners have broken on this map today. */
    _townRocksToday() {
        const t = this._townQuarry;
        const day = this._fellDay();
        return t && t.day === day && t.hex === this._fellHex ? t.n : 0;
    },

    /** Off to break a rock: stand at its side (else below it), facing it, pick in hand. False if none will do. */
    _goToRock(npc) {
        const C = this.townMineConfig();
        if (this._townRocksToday() >= C.maxPerDay) return false;
        const rock = this._pickTownTree(npc, 'rock');
        if (!rock) return false;
        const spot = this._standBy(npc, rock.trunk);
        if (!spot) return false;
        const face = spot.q < rock.trunk.q ? 3 : spot.q > rock.trunk.q ? 1 : 0;
        npc._chop = { q: rock.q, r: rock.r, defId: rock.def.id, timer: 0, interval: C.interval, blow: C.blow, tool: 'pickaxe', going: true };
        if (this._goStand(npc, spot, 'chop', face)) return true;
        npc._chop = null;
        return false;
    },

    /** The rock gives: it is gone, and the stone goes on their back. */
    _townBreak(npc, tile, def) {
        const ch = npc._chop;
        const res = tile.customObject.resource || (def && def.resource) || null;
        this._removeCustomObject(ch.q, ch.r, { spawn: false });
        const day = this._fellDay();
        const t = this._townQuarry;
        this._townQuarry = t && t.day === day && t.hex === this._fellHex ? { ...t, n: t.n + 1 } : { day, hex: this._fellHex, n: 1 };
        this._chopEvents.push({ kind: 'broken', q: ch.q, r: ch.r, defId: ch.defId, cutterQ: npc.q, cutterR: npc.r });
        const C = this.townMineConfig();
        npc._carry = { good: 'stone', qty: Math.min(C.carryMax, Math.max(1, Math.round((res && res.amount) || 5))) };
        this._stopChopping(npc);
        npc.idleTimer = 1;
    },

    // ── What the woodcutters and miners carry in ──

    /** Is this load for the town's yard (logs, firewood, stone)? */
    _isYardLoad(c) {
        return !!(c && (c.good === 'wood' || c.good === 'firewood' || c.good === 'stone'));
    },

    /** Where a yard load is taken, in order of preference. */
    _yardStores(c) {
        if (!this._isYardLoad(c)) return null;
        return c.good === 'stone' ? this.townMineConfig().stores : this.townWoodConfig().stores;
    },

    /** Gone indoors with a yard load: logs and firewood (townWoodcutters.js), stone into the town's goods. */
    _yardDelivered(npc, bldg) {
        const c = npc._carry;
        if (!c || !bldg) return false;
        if (c.good !== 'stone') return this._townWoodDelivered(npc, bldg);
        const C = this.townMineConfig();
        if (!(C.stores || []).includes(bldg.type)) return false;
        npc._carry = null;
        const ref = this._currentWorldTileRef;
        const econ = ref && ref.settlement && ref.settlement.economy;
        if (econ) econ.goods = (Number(econ.goods) || 0) + c.qty * (Number(C.goodsPerStone) || 0);
        return true;
    },
});
