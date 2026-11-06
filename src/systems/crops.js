// ============================================
// CROPS — the player's own fields on the inner map
// ============================================
// Till a patch of ground on a hex's local map, sow seed bought at market (or
// found foraging) on it, keep it watered, and harvest it ripe. Content lives
// in data/crops.json; the menu, the work and the drawing are
// ui/innerMapFarming.js; re-laying the tilled soil on a regenerated map is
// world/innerMap/farmPlots.js.
//
// State, per hex, on the player (saved with them — inner maps are not):
//
//   player.farmPlots["wq,wr"] = { cells: { "iq,ir": cell } }
//   cell = { crop: null }                                 tilled, nothing sown
//        | { crop, sownDay, growth, wetDays, days, dry, watered,
//            ripeDays, dead: null|'frost'|'wilted'|'spoiled', lastDay }
//
// processDay(world, player), once per world day from endDay: every sown cell
// grows a day — fully on a wet day (rain on its hex, or watered by hand that
// day), dryGrowth on a dry one; too many dry days in a row wilt it, winter
// frost kills a crop that isn't hardy, a ripe crop left too long rots. Growth
// goes on while the player is away. Yield at harvest: a roll in the crop's
// range × the care it had (wet days ÷ days grown) × the farming skill. The
// farming level (systems/foodSkills.js) also lets a crop bear more dry days
// and live through a few frost days (cell.frostDays) before the frost takes it.
//
// Seed is sold in markets (world/economy.js marketGoods reads data/crops.json).
// No randomness but the harvest roll (Utils); no domain globals.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PlayerInventory } from '../core/inventory.js';
import { Seasons } from '../world/seasons.js';
import { FoodSkills } from './foodSkills.js';

const DEFAULTS = {
    maxCellsPerHex: 60,
    dryGrowth: 0.5,
    winterGrowth: 0.5,
    careFloor: 0.5,
    frostSeason: 'Winter',
    rainTypes: ['rain', 'storm', 'snow'],
    dryTolerance: { low: 6, medium: 4, high: 3 },
    spoilDays: 6,
    minutes: { till: 20, plant: 15, water: 5, harvest: 10, clear: 5 },
    seconds: { till: 3, plant: 1.5, water: 1, harvest: 1.5, clear: 1 },
    waterReach: 30,
    townRoadBuffer: 4,
    sheets: {},
    sownArt: null,
    crops: {},
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const Crops = {
    /** data/crops.json over the defaults. */
    config() {
        const src = (DataLoader._gamedata && DataLoader._gamedata.crops) || null;
        if (!src) return DEFAULTS;
        return {
            ...DEFAULTS, ...src,
            dryTolerance: { ...DEFAULTS.dryTolerance, ...(src.dryTolerance || {}) },
            minutes: { ...DEFAULTS.minutes, ...(src.minutes || {}) },
            seconds: { ...DEFAULTS.seconds, ...(src.seconds || {}) },
        };
    },

    /** A crop's definition (with its id), or null. */
    crop(id) {
        const c = id && this.config().crops[id];
        return c ? { id, ...c } : null;
    },

    /** Every crop, in data order. */
    list() {
        return Object.keys(this.config().crops || {}).map(id => this.crop(id));
    },

    /** The crop a seed good sows, or null. */
    cropForSeed(seedId) {
        return this.list().find(c => c.seed === seedId) || null;
    },

    /** Is `goodId` a seed? */
    isSeed(goodId) {
        return !!this.cropForSeed(goodId);
    },

    hexKey(wq, wr) { return `${wq},${wr}`; },
    cellKey(iq, ir) { return `${iq},${ir}`; },

    /** The season today ('Spring' … 'Winter'). */
    season(world) {
        if (world && typeof world.season === 'string') return world.season;
        const day = Seasons.today(world);
        return day != null ? Seasons.seasonOf(day) : 'Spring';
    },

    /** The farm plot of a hex: { cells } (made when `create`), or null. */
    plot(player, wq, wr, create = false) {
        if (!player) return null;
        if (!player.farmPlots || typeof player.farmPlots !== 'object') {
            if (!create) return null;
            player.farmPlots = {};
        }
        const key = this.hexKey(wq, wr);
        let p = player.farmPlots[key];
        if (!p && create) p = player.farmPlots[key] = { cells: {} };
        if (p && !p.cells) p.cells = {};
        return p || null;
    },

    /** The cell at inner (iq, ir) of hex (wq, wr), or null when it isn't tilled. */
    cell(player, wq, wr, iq, ir) {
        const p = this.plot(player, wq, wr);
        return (p && p.cells[this.cellKey(iq, ir)]) || null;
    },

    /** How many cells of this hex are tilled. */
    cellCount(player, wq, wr) {
        const p = this.plot(player, wq, wr);
        return p ? Object.keys(p.cells).length : 0;
    },

    /** Room for another tilled cell on this hex? */
    hasRoom(player, wq, wr) {
        return this.cellCount(player, wq, wr) < _num(this.config().maxCellsPerHex, 60);
    },

    /** Record a tilled cell. { ok, reason } */
    markTilled(player, wq, wr, iq, ir) {
        if (!player) return { ok: false, reason: 'Nobody to till it.' };
        if (this.cell(player, wq, wr, iq, ir)) return { ok: true, already: true };
        if (!this.hasRoom(player, wq, wr)) {
            return { ok: false, reason: `You can't work more than ${this.config().maxCellsPerHex} patches of ground here.` };
        }
        this.plot(player, wq, wr, true).cells[this.cellKey(iq, ir)] = { crop: null };
        return { ok: true };
    },

    /** Forget a tilled cell (the ground built over, or let go). */
    removeCell(player, wq, wr, iq, ir) {
        const p = this.plot(player, wq, wr);
        if (!p) return false;
        const k = this.cellKey(iq, ir);
        if (!p.cells[k]) return false;
        delete p.cells[k];
        if (!Object.keys(p.cells).length) delete player.farmPlots[this.hexKey(wq, wr)];
        return true;
    },

    /** May this crop be sown in `season`? */
    canSow(crop, season) {
        return !!crop && Array.isArray(crop.sow) && crop.sow.includes(season);
    },

    /** The seeds the player carries: [{ crop, seed, qty, inSeason }]. */
    seedsHeld(player, season) {
        const inv = (player && player.inventory) || {};
        const out = [];
        for (const crop of this.list()) {
            const qty = _num(inv[crop.seed]);
            if (qty > 0) out.push({ crop, seed: crop.seed, qty, inSeason: this.canSow(crop, season) });
        }
        return out;
    },

    /** Can `cropId` be sown on this cell now? { ok, reason } */
    canPlant(player, world, wq, wr, iq, ir, cropId) {
        const crop = this.crop(cropId);
        if (!crop) return { ok: false, reason: 'No such crop.' };
        const cell = this.cell(player, wq, wr, iq, ir);
        if (!cell) return { ok: false, reason: 'Till the ground first.' };
        if (cell.crop) return { ok: false, reason: 'Something is already sown here.' };
        const season = this.season(world);
        if (!this.canSow(crop, season)) return { ok: false, reason: `${crop.name} isn't sown in ${season}. Sow it in ${crop.sow.join(' or ')}.` };
        if (!(_num(player.inventory && player.inventory[crop.seed]) > 0)) return { ok: false, reason: `You have no ${crop.name.toLowerCase()} seed.` };
        return { ok: true, crop };
    },

    /** Sow a cell: takes one seed. { ok, reason, crop } */
    plant(player, world, wq, wr, iq, ir, cropId) {
        const chk = this.canPlant(player, world, wq, wr, iq, ir, cropId);
        if (!chk.ok) return chk;
        const crop = chk.crop;
        player.inventory[crop.seed] -= 1;
        if (player.inventory[crop.seed] <= 0) delete player.inventory[crop.seed];
        const day = _num(world && world.day);
        const cell = this.cell(player, wq, wr, iq, ir);
        Object.assign(cell, { crop: crop.id, sownDay: day, growth: 0, wetDays: 0, days: 0, dry: 0, watered: false, ripeDays: 0, dead: null, lastDay: day });
        return { ok: true, crop };
    },

    /** Water a sown cell for today. { ok, reason } */
    water(player, wq, wr, iq, ir) {
        const cell = this.cell(player, wq, wr, iq, ir);
        if (!cell || !cell.crop) return { ok: false, reason: 'Nothing is growing here.' };
        if (cell.dead) return { ok: false, reason: 'It is past watering.' };
        if (cell.watered) return { ok: false, reason: 'It has been watered today.' };
        cell.watered = true;
        return { ok: true };
    },

    /** Days of growth a crop needs to ripen (on wet days). */
    growDays(crop) {
        return (crop && Array.isArray(crop.stages) ? crop.stages : [3, 3, 3]).reduce((s, n) => s + _num(n), 0);
    },

    /** Is the cell's crop ripe (and not dead)? */
    isRipe(cell) {
        if (!cell || !cell.crop || cell.dead) return false;
        return _num(cell.growth) >= this.growDays(this.crop(cell.crop));
    },

    /**
     * Where a cell stands: { phase: 'tilled'|'sown'|'growing'|'ripe'|'dead',
     * artIndex (0..stages-1 while growing), crop, daysLeft, watered, dead }.
     */
    status(cell) {
        if (!cell || !cell.crop) return { phase: 'tilled', crop: null };
        const crop = this.crop(cell.crop);
        if (!crop) return { phase: 'tilled', crop: null };
        const total = this.growDays(crop);
        const g = _num(cell.growth);
        const base = { crop, watered: !!cell.watered, dead: cell.dead || null };
        if (cell.dead) {
            // The stage it died at, for the withered art
            return { ...base, phase: 'dead', artIndex: this._artIndex(crop, Math.min(g, total - 0.01)), ripe: cell.dead === 'spoiled' };
        }
        if (g >= total) return { ...base, phase: 'ripe', daysLeft: 0, spoilsIn: Math.max(0, _num(this.config().spoilDays, 6) - _num(cell.ripeDays)) };
        const daysLeft = Math.ceil(total - g);
        if (g < 1) return { ...base, phase: 'sown', artIndex: -1, daysLeft };
        return { ...base, phase: 'growing', artIndex: this._artIndex(crop, g), daysLeft };
    },

    _artIndex(crop, g) {
        const stages = Array.isArray(crop.stages) ? crop.stages : [3, 3, 3];
        let acc = 0;
        for (let i = 0; i < stages.length; i++) {
            acc += _num(stages[i]);
            if (g < acc) return i;
        }
        return stages.length - 1;
    },

    /** "Cabbage — 3 days to ripen, watered today" */
    describe(cell, world = null, wq = null, wr = null) {
        const s = this.status(cell);
        if (s.phase === 'tilled') return 'Tilled soil, ready for sowing';
        const name = s.crop.name;
        if (s.phase === 'dead') {
            const why = { frost: 'killed by the frost', wilted: 'wilted for want of water', spoiled: 'rotted in the ground' }[s.dead] || 'dead';
            return `${name} — ${why}`;
        }
        if (s.phase === 'ripe') return `${name} — ripe! Harvest within ${s.spoilsIn} day${s.spoilsIn === 1 ? '' : 's'}`;
        const wet = s.watered ? 'watered today'
            : (world && wq != null && this.rainedOn(world, wq, wr) ? 'rain is watering it' : 'dry today');
        const thirst = !s.watered && _num(cell.dry) > 0 ? ` (${cell.dry} dry day${cell.dry === 1 ? '' : 's'})` : '';
        return `${name} — ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} to ripen, ${wet}${thirst}`;
    },

    /** Is it raining (or snowing) on this hex today? */
    rainedOn(world, wq, wr) {
        if (!world || !world.weather || typeof world.weather.getWeather !== 'function') return false;
        const w = world.weather.getWeather(wq, wr);
        return !!(w && (this.config().rainTypes || []).includes(w.type));
    },

    /**
     * A world day for every field: growth, thirst, frost and rot.
     * @returns {{ notices: Array<{icon,title,text,type}> }}
     */
    processDay(world, player) {
        const notices = [];
        if (!player || !player.farmPlots || typeof player.farmPlots !== 'object') return { notices };
        const C = this.config();
        const day = _num(world && world.day);
        const season = this.season(world);
        const frost = season === C.frostSeason;
        const frostGrace = FoodSkills.farmFrostDays(player);
        const dryGrace = FoodSkills.farmDryDays(player);
        for (const [hk, plot] of Object.entries(player.farmPlots)) {
            if (!plot || !plot.cells) continue;
            const [wq, wr] = hk.split(',').map(Number);
            const rained = this.rainedOn(world, wq, wr);
            const tally = { ripe: {}, frost: {}, wilted: {}, spoiled: {} };
            for (const cell of Object.values(plot.cells)) {
                if (!cell || !cell.crop || cell.dead) continue;
                if (cell.lastDay === day && day !== 0) continue; // already counted today
                cell.lastDay = day;
                const crop = this.crop(cell.crop);
                if (!crop) continue;
                const wet = rained || !!cell.watered;
                cell.watered = false;
                if (frost && !crop.hardy) {
                    // A practised farmer's tender crop lives through a few frosts
                    cell.frostDays = _num(cell.frostDays) + 1;
                    if (cell.frostDays > frostGrace) {
                        cell.dead = 'frost';
                        tally.frost[crop.name] = (tally.frost[crop.name] || 0) + 1;
                        continue;
                    }
                }
                const total = this.growDays(crop);
                if (_num(cell.growth) >= total) {
                    cell.ripeDays = _num(cell.ripeDays) + 1;
                    if (cell.ripeDays > _num(C.spoilDays, 6)) {
                        cell.dead = 'spoiled';
                        tally.spoiled[crop.name] = (tally.spoiled[crop.name] || 0) + 1;
                    }
                    continue;
                }
                cell.days = _num(cell.days) + 1;
                let rate = wet ? 1 : _num(C.dryGrowth, 0.5);
                if (frost) rate *= _num(C.winterGrowth, 0.5);
                if (wet) {
                    cell.wetDays = _num(cell.wetDays) + 1;
                    cell.dry = 0;
                } else {
                    cell.dry = _num(cell.dry) + 1;
                    const tol = _num(C.dryTolerance[crop.water], 4) + dryGrace;
                    if (cell.dry > tol) {
                        cell.dead = 'wilted';
                        tally.wilted[crop.name] = (tally.wilted[crop.name] || 0) + 1;
                        continue;
                    }
                }
                const before = _num(cell.growth);
                cell.growth = Math.round((before + rate) * 100) / 100;
                if (before < total && cell.growth >= total) {
                    cell.ripeDays = 0;
                    tally.ripe[crop.name] = (tally.ripe[crop.name] || 0) + 1;
                }
            }
            const where = this._placeName(world, wq, wr);
            const list = (o) => Object.entries(o).map(([n, k]) => `${n} (${k})`).join(', ');
            if (Object.keys(tally.ripe).length) notices.push({ icon: '🌾', title: 'Crops Ripe', text: `Ripe for harvest at ${where}: ${list(tally.ripe)}.`, type: 'success' });
            if (Object.keys(tally.frost).length) notices.push({ icon: '❄️', title: 'Frost', text: `The frost killed your ${list(tally.frost)} at ${where}.`, type: 'warning' });
            if (Object.keys(tally.wilted).length) notices.push({ icon: '🥀', title: 'Crops Wilted', text: `Too many dry days: your ${list(tally.wilted)} at ${where} wilted.`, type: 'warning' });
            if (Object.keys(tally.spoiled).length) notices.push({ icon: '🍂', title: 'Crops Rotted', text: `Left too long, your ${list(tally.spoiled)} at ${where} rotted in the ground.`, type: 'warning' });
        }
        return { notices };
    },

    _placeName(world, wq, wr) {
        const t = world && typeof world.getTile === 'function' ? world.getTile(wq, wr) : null;
        if (t && t.settlement && t.settlement.name) return t.settlement.name;
        return `your fields (${wq}, ${wr})`;
    },

    /** The harvest a ripe cell yields for this player (rolls Utils): × the farming level's yield. */
    yieldFor(player, cell) {
        const C = this.config();
        const crop = this.crop(cell && cell.crop);
        if (!crop) return 0;
        const [lo, hi] = Array.isArray(crop.yield) ? crop.yield : [1, 2];
        const base = Utils.randInt(Math.round(lo), Math.round(hi));
        const days = Math.max(1, _num(cell.days));
        const care = Math.max(_num(C.careFloor, 0.5), Math.min(1, _num(cell.wetDays) / days));
        return Math.max(1, Math.round(base * care * FoodSkills.farmYieldMult(player)));
    },

    /** Harvest a ripe cell into the packs; the ground stays tilled. { ok, reason, good, qty, crop } */
    harvest(player, wq, wr, iq, ir) {
        const cell = this.cell(player, wq, wr, iq, ir);
        if (!cell || !cell.crop) return { ok: false, reason: 'Nothing is growing here.' };
        if (cell.dead) return { ok: false, reason: 'There is nothing worth taking: clear it.' };
        if (!this.isRipe(cell)) return { ok: false, reason: 'It isn\'t ripe yet.' };
        const crop = this.crop(cell.crop);
        if (!PlayerInventory.canAdd(player, crop.product)) return { ok: false, reason: PlayerInventory.fullMessage(player), full: true };
        const qty = this.yieldFor(player, cell);
        PlayerInventory.addItem(player, crop.product, qty);
        this._reset(cell);
        return { ok: true, good: crop.product, qty, crop };
    },

    /** Pull up a dead crop (or a growing one): back to bare tilled soil. */
    clear(player, wq, wr, iq, ir) {
        const cell = this.cell(player, wq, wr, iq, ir);
        if (!cell || !cell.crop) return { ok: false, reason: 'Nothing to clear.' };
        this._reset(cell);
        return { ok: true };
    },

    _reset(cell) {
        for (const k of Object.keys(cell)) delete cell[k];
        cell.crop = null;
    },

    /** Every sown or tilled cell as a list, for a panel or a test: [{ hex, iq, ir, cell }]. */
    allCells(player) {
        const out = [];
        for (const [hex, plot] of Object.entries((player && player.farmPlots) || {})) {
            for (const [ck, cell] of Object.entries((plot && plot.cells) || {})) {
                const [iq, ir] = ck.split(',').map(Number);
                out.push({ hex, iq, ir, cell });
            }
        }
        return out;
    },
};
