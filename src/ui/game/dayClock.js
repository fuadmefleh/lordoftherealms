// ============================================================
// DAY CLOCK — action points and the hours of the day, one budget
// ============================================================
// The day has one clock (InnerMap.timeOfDay + _timeAccumulator, shown in the top
// bar): the town and country maps run it on (a real minute an hour) and the work
// done there in person moves it on (InnerMap.passHours). Here the two halves of
// the day's budget are tied together, each frame:
//
//   • every action point spent, anywhere (travel, a job, trade, an audience…),
//     passes hoursPerAP hours on the clock, so a full day's points take you from
//     waking (wakeHour) to late evening;
//   • and the hours run the other way too: you can never hold more points than
//     the hours left before midnight allow (floor(hoursLeft / hoursPerAP)), so an
//     afternoon spent walking a town, at work in a field or asleep costs points.
//
// It watches the points rather than being told of each spend, so every one of
// the many places that spend them is counted without touching them. A rise in
// points (the new day's refill, a bonus) is taken as it is.
//
// Data: data/innerMap.json "dayClock".

import { InnerMap } from '../../world/innerMap.js';
import { DataLoader } from '../../core/dataLoader.js';

const DEFAULTS = { hoursPerAP: 1.5, wakeHour: 8 };

export const DayClock = {
    _seenAP: null,
    _seenDay: null,

    config() {
        const d = (DataLoader._gamedata && DataLoader._gamedata.innerMap && DataLoader._gamedata.innerMap.dayClock) || {};
        const per = Number(d.hoursPerAP);
        const wake = Number(d.wakeHour);
        return { hoursPerAP: per > 0 ? per : DEFAULTS.hoursPerAP, wakeHour: Number.isFinite(wake) ? wake : DEFAULTS.wakeHour };
    },

    /** The hour now, with its minutes (8.5 = half past eight). */
    now() {
        const scale = InnerMap.TIME_SCALE || 60;
        const h = Number(InnerMap.timeOfDay);
        if (!Number.isFinite(h)) return this.config().wakeHour;
        return h + (Number(InnerMap._timeAccumulator) || 0) / scale;
    },

    /** Hours left before midnight. */
    hoursLeft() {
        return Math.max(0, 24 - this.now());
    },

    /** The most action points the hours left allow. */
    pointsTimeAllows() {
        return Math.floor(this.hoursLeft() / this.config().hoursPerAP + 1e-6);
    },

    /** Each frame: points spent move the clock on; the clock caps the points. */
    sync(game) {
        const p = game && game.player;
        const world = game && game.world;
        if (!p || !world || game.isProcessingTurn || !Number.isFinite(p.actionPoints)) return;
        const day = world.day;
        if (this._seenDay !== day || this._seenAP == null || p.actionPoints > this._seenAP) {
            // a new day, a fresh start, or points given back: nothing spent
            this._seenDay = day;
            this._seenAP = p.actionPoints;
        } else if (p.actionPoints < this._seenAP) {
            const spent = this._seenAP - p.actionPoints;
            if (typeof InnerMap.passHours === 'function') InnerMap.passHours(spent * this.config().hoursPerAP);
            this._seenAP = p.actionPoints;
        }
        const cap = this.pointsTimeAllows();
        if (p.actionPoints > cap) {
            p.actionPoints = cap;
            this._seenAP = cap;
            if (game.ui && game.ui.updateStats && !this._capRefresh) {
                // (the top bar's points, now and then rather than every frame)
                this._capRefresh = true;
                setTimeout(() => { this._capRefresh = false; game.ui.updateStats(game.player, game.world); }, 250);
            }
        }
    },

    /** A new day's clock (not a midnight run-on): up at wakeHour. */
    wake() {
        InnerMap.timeOfDay = this.config().wakeHour;
        InnerMap._timeAccumulator = 0;
        InnerMap.dayEnded = false;
        this._seenAP = null;
    },
};
